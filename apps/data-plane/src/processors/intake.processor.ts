/**
 * Intake processor — handles submission.accepted queue.
 *
 * Pipeline:
 * 1. Validate payload hash (SHA-256 of content vs normalizedHash in Submission)
 * 2. Enforce idempotency (tenantId + submissionId dedupe)
 * 3. File security: filename validation, magic-byte validation, size ceiling
 * 4. Malware scan gate (if MALWARE_SCAN_ENABLED)
 * 5. Enqueue to delivery.requested
 * 6. Write audit event SUBMISSION_QUEUED
 * 7. Update submission status to QUEUED
 */

import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { DatabaseService, type Prisma } from '@sep/db';
import {
  SepError,
  ErrorCode,
  getConfig,
  type SubmissionJob,
  type CryptoJob,
  type KeyReferenceId,
} from '@sep/common';
import { createLogger, submissionCounter } from '@sep/observability';
import { QUEUES } from '../queues/queue.definitions';
import { AuditWriterService } from '../services/audit-writer.service';
import type { IObjectStorageService } from '../services/object-storage.service';

const logger = createLogger({ service: 'data-plane', module: 'intake' });

// Strict filename allowlist: alphanumeric, hyphens, underscores, dots, max 255 chars
const SAFE_FILENAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,253}[a-zA-Z0-9]$/;
const FORBIDDEN_FILENAME_CHARS = /[/\\:\0<>|"?*]/;

// ── Magic-byte signatures for file type validation ───────────────────────────
// Maps file extension to expected magic-byte prefixes (first N bytes).
// A file with a known extension but wrong magic bytes is rejected.
const MAGIC_BYTE_SIGNATURES: ReadonlyMap<string, readonly Buffer[]> = new Map([
  ['.pdf', [Buffer.from([0x25, 0x50, 0x44, 0x46])]], // %PDF
  ['.xml', [Buffer.from('<?xml', 'utf-8'), Buffer.from([0xef, 0xbb, 0xbf])]], // <?xml or UTF-8 BOM
  ['.zip', [Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from([0x50, 0x4b, 0x05, 0x06])]], // PK
  ['.gz', [Buffer.from([0x1f, 0x8b])]], // gzip
  [
    '.pgp',
    [
      Buffer.from([0xc5]),
      Buffer.from([0xc6]),
      Buffer.from([0xc7]), // binary PGP
      Buffer.from('-----BEGIN PGP', 'utf-8'),
    ],
  ], // armored PGP
  [
    '.gpg',
    [
      Buffer.from([0xc5]),
      Buffer.from([0xc6]),
      Buffer.from([0xc7]),
      Buffer.from('-----BEGIN PGP', 'utf-8'),
    ],
  ],
  ['.png', [Buffer.from([0x89, 0x50, 0x4e, 0x47])]], // PNG header
  ['.jpg', [Buffer.from([0xff, 0xd8, 0xff])]], // JPEG header
  ['.jpeg', [Buffer.from([0xff, 0xd8, 0xff])]],
]);

/** Maximum bytes to read for magic-byte inspection */
const MAGIC_BYTE_READ_SIZE = 16;

@Processor(QUEUES.SUBMISSION_ACCEPTED)
export class IntakeProcessor extends WorkerHost {
  private readonly auditWriter: AuditWriterService;

  constructor(
    private readonly database: DatabaseService,
    @InjectQueue(QUEUES.DELIVERY_REQUESTED) private readonly deliveryQueue: Queue,
    private readonly objectStorage: IObjectStorageService,
  ) {
    super();
    this.auditWriter = new AuditWriterService(database);
  }

  async process(job: Job<SubmissionJob>): Promise<void> {
    const {
      correlationId,
      tenantId,
      submissionId,
      partnerProfileId,
      payloadRef,
      normalizedHash,
      actorId,
      actorRole,
      credentialId,
    } = job.data;

    logger.info(
      { correlationId, tenantId, submissionId, attempt: job.attemptsMade },
      'Intake processing started',
    );

    await this.database.forTenant(tenantId, async (db) => {
      // 1. Load and verify submission exists and belongs to tenant
      const submission = await db.submission.findFirst({
        where: { id: submissionId, tenantId },
      });

      if (!submission) {
        throw new SepError(ErrorCode.SUBMISSION_NOT_FOUND, {
          submissionId,
          tenantId,
          correlationId,
        });
      }

      // 2. Idempotency: if already past RECEIVED, this is a retry of a completed intake
      if (submission.status !== 'RECEIVED' && submission.status !== 'VALIDATED') {
        logger.info(
          { correlationId, tenantId, submissionId, currentStatus: submission.status },
          'Intake skipped — submission already past intake stage',
        );
        return;
      }

      // 3. Validate payload hash
      if (
        submission.normalizedHash !== null &&
        submission.normalizedHash !== '' &&
        normalizedHash !== ''
      ) {
        const hashMatch = submission.normalizedHash === normalizedHash;
        if (!hashMatch) {
          await this.failSubmission(
            db,
            submissionId,
            tenantId,
            ErrorCode.SUBMISSION_PAYLOAD_TAMPERED,
          );
          await this.auditWriter.record({
            tenantId,
            actorType: 'SERVICE',
            actorId,
            objectType: 'Submission',
            objectId: submissionId,
            action: 'SUBMISSION_FAILED',
            result: 'FAILURE',
            correlationId,
            metadata: {
              reason: 'payload_hash_mismatch',
              errorCode: ErrorCode.SUBMISSION_PAYLOAD_TAMPERED,
            },
          });
          throw new SepError(ErrorCode.SUBMISSION_PAYLOAD_TAMPERED, {
            submissionId,
            correlationId,
          });
        }
      }

      // 4. Validate filename if present in metadata
      const metadata = submission.metadata as Record<string, unknown> | null;
      if (metadata?.['filename'] !== undefined && metadata['filename'] !== null) {
        this.validateFilename(String(metadata['filename']), correlationId);
      }

      // 5. Magic-byte validation — verify file extension matches actual content
      if (
        metadata?.['filename'] !== undefined &&
        metadata['filename'] !== null &&
        payloadRef !== ''
      ) {
        await this.validateMagicBytes(String(metadata['filename']), payloadRef, correlationId);
      }

      // 6. Validate payload size ceiling
      const cfg = getConfig();
      if (
        submission.payloadSize !== null &&
        submission.payloadSize > cfg.storage.maxPayloadSizeBytes
      ) {
        await this.failSubmission(
          db,
          submissionId,
          tenantId,
          ErrorCode.VALIDATION_PAYLOAD_TOO_LARGE,
        );
        throw new SepError(ErrorCode.VALIDATION_PAYLOAD_TOO_LARGE, {
          submissionId,
          correlationId,
        });
      }

      // 7. Malware scan gate
      if (cfg.features.malwareScanEnabled) {
        // If malware scanning is enabled but scanner is unavailable, fail closed
        logger.warn(
          { correlationId, tenantId, submissionId },
          'Malware scan enabled but scanner not yet integrated — failing closed',
        );
        await this.failSubmission(
          db,
          submissionId,
          tenantId,
          ErrorCode.SUBMISSION_SCAN_UNAVAILABLE,
        );
        throw new SepError(ErrorCode.SUBMISSION_SCAN_UNAVAILABLE, {
          submissionId,
          correlationId,
          message: 'Malware scanner unavailable — fail closed',
        });
      }

      // 8. Load partner profile to determine crypto operation
      const profile = await db.partnerProfile.findFirst({
        where: { id: partnerProfileId, tenantId },
        select: {
          id: true,
          messageSecurityMode: true,
          transportProtocol: true,
          environment: true,
          status: true,
          config: true,
        },
      });

      if (!profile) {
        throw new SepError(ErrorCode.RBAC_RESOURCE_NOT_FOUND, {
          tenantId,
          profileId: partnerProfileId,
          correlationId,
        });
      }

      if (
        profile.status !== 'PROD_ACTIVE' &&
        profile.status !== 'TEST_APPROVED' &&
        profile.status !== 'TEST_READY'
      ) {
        throw new SepError(ErrorCode.POLICY_PROFILE_INACTIVE, {
          tenantId,
          profileId: partnerProfileId,
          correlationId,
          currentState: profile.status,
        });
      }

      // 9. Determine crypto requirements from profile
      const cryptoOperation = this.mapSecurityModeToCryptoOp(profile.messageSecurityMode);
      const profileConfig = profile.config as Record<string, unknown> | null;
      const keyReferenceId = profileConfig?.['keyReferenceId'] as string | undefined;

      // 10. Update submission to VALIDATED
      await db.submission.update({
        where: { id: submissionId },
        data: { status: 'VALIDATED', updatedAt: new Date() },
      });

      // 11. Enqueue to delivery.requested (crypto stage)
      if (cryptoOperation !== null && keyReferenceId !== undefined && keyReferenceId !== '') {
        const cryptoJob: CryptoJob = {
          jobId: `crypto-${submissionId}-${job.attemptsMade}`,
          correlationId: correlationId,
          tenantId: tenantId,
          submissionId: submissionId,
          partnerProfileId: partnerProfileId,
          payloadRef,
          normalizedHash,
          attempt: 1,
          enqueuedAt: new Date().toISOString(),
          actorId,
          actorRole,
          credentialId,
          operation: cryptoOperation,
          keyReferenceId: keyReferenceId as KeyReferenceId,
        };

        await this.deliveryQueue.add('crypto', cryptoJob, {
          jobId: `crypto-${submissionId}`,
        });
      } else {
        // No crypto needed — enqueue directly for delivery
        const deliveryJob = {
          ...job.data,
          securedPayloadRef: payloadRef,
          connectorType: profile.transportProtocol,
          attempt: 1,
          enqueuedAt: new Date().toISOString(),
        };
        await this.deliveryQueue.add('delivery', deliveryJob, {
          jobId: `delivery-${submissionId}`,
        });
      }

      // 12. Update submission to QUEUED
      await db.submission.update({
        where: { id: submissionId },
        data: { status: 'QUEUED', updatedAt: new Date() },
      });

      // 13. Write audit event
      await this.auditWriter.record({
        tenantId,
        actorType: 'SERVICE',
        actorId,
        actorRole: actorRole as 'INTEGRATION_ENGINEER',
        objectType: 'Submission',
        objectId: submissionId,
        action: 'SUBMISSION_QUEUED',
        result: 'SUCCESS',
        correlationId,
        environment: profile.environment,
        metadata: {
          partnerProfileId,
          cryptoOperation: cryptoOperation ?? 'NONE',
          transportProtocol: profile.transportProtocol,
        },
      });

      submissionCounter.inc({
        tenant_id: tenantId,
        partner_profile_id: partnerProfileId,
        status: 'QUEUED',
        environment: profile.environment,
      });

      logger.info(
        { correlationId, tenantId, submissionId, status: 'QUEUED' },
        'Intake processing completed',
      );
    });
  }

  private validateFilename(filename: string, correlationId: string): void {
    if (FORBIDDEN_FILENAME_CHARS.test(filename)) {
      throw new SepError(ErrorCode.VALIDATION_FILENAME_INVALID, {
        correlationId,
        message: 'Filename contains forbidden characters (path separators, null bytes)',
      });
    }
    if (!SAFE_FILENAME_PATTERN.test(filename)) {
      throw new SepError(ErrorCode.VALIDATION_FILENAME_INVALID, {
        correlationId,
        message: 'Filename does not match allowed pattern',
      });
    }
    if (filename.includes('..')) {
      throw new SepError(ErrorCode.VALIDATION_FILENAME_INVALID, {
        correlationId,
        message: 'Filename contains path traversal sequence',
      });
    }
  }

  private async validateMagicBytes(
    filename: string,
    payloadRef: string,
    correlationId: string,
  ): Promise<void> {
    const ext = this.extractExtension(filename);
    if (ext === null) {
      return; // No extension → no magic-byte check (e.g. extensionless files allowed through)
    }

    const expectedSignatures = MAGIC_BYTE_SIGNATURES.get(ext);
    if (expectedSignatures === undefined) {
      return; // Unknown extension → no magic-byte check (csv, txt, etc. have no magic bytes)
    }

    const { bucket, key } = this.parsePayloadRef(payloadRef);
    let headBytes: Buffer;
    try {
      headBytes = await this.objectStorage.getObjectHead(bucket, key, MAGIC_BYTE_READ_SIZE);
    } catch (err) {
      // If we cannot read from storage, fail closed
      logger.error(
        { correlationId, payloadRef },
        'Cannot read payload head for magic-byte validation — failing closed',
      );
      throw new SepError(ErrorCode.STORAGE_DOWNLOAD_FAILED, {
        correlationId,
        message: 'Cannot read payload for magic-byte validation',
      });
    }

    const matches = expectedSignatures.some((sig) => {
      if (headBytes.length < sig.length) {
        return false;
      }
      return headBytes.subarray(0, sig.length).equals(sig);
    });

    if (!matches) {
      logger.warn(
        { correlationId, filename, extension: ext },
        'Magic-byte mismatch — file content does not match extension',
      );
      throw new SepError(ErrorCode.VALIDATION_MAGIC_BYTES_MISMATCH, {
        correlationId,
        message: `File content does not match declared extension: ${filename} (${ext})`,
      });
    }
  }

  private extractExtension(filename: string): string | null {
    const dotIdx = filename.lastIndexOf('.');
    if (dotIdx < 1) {
      return null;
    }
    return filename.substring(dotIdx).toLowerCase();
  }

  private parsePayloadRef(ref: string): { bucket: string; key: string } {
    // Format: s3://bucket/key or bucket/key
    if (ref.startsWith('s3://')) {
      const path = ref.substring(5);
      const slashIdx = path.indexOf('/');
      if (slashIdx < 0) {
        return { bucket: path, key: '' };
      }
      return { bucket: path.substring(0, slashIdx), key: path.substring(slashIdx + 1) };
    }
    const slashIdx = ref.indexOf('/');
    if (slashIdx < 0) {
      return { bucket: ref, key: '' };
    }
    return { bucket: ref.substring(0, slashIdx), key: ref.substring(slashIdx + 1) };
  }

  private mapSecurityModeToCryptoOp(mode: string): CryptoJob['operation'] | null {
    switch (mode) {
      case 'NONE':
        return null;
      case 'ENCRYPT':
        return 'ENCRYPT';
      case 'SIGN':
        return 'SIGN';
      case 'SIGN_ENCRYPT':
        return 'SIGN_ENCRYPT';
      case 'VERIFY':
        return 'VERIFY';
      case 'DECRYPT':
        return 'DECRYPT';
      case 'VERIFY_DECRYPT':
        return 'VERIFY_DECRYPT';
      default: {
        const _exhaustive: never = mode as never;
        throw new SepError(ErrorCode.CONFIGURATION_ERROR, {
          message: `Unknown message security mode: ${String(_exhaustive)}`,
        });
      }
    }
  }

  private async failSubmission(
    db: Prisma.TransactionClient,
    submissionId: string,
    _tenantId: string,
    errorCode: ErrorCode,
  ): Promise<void> {
    await db.submission.update({
      where: { id: submissionId },
      data: {
        status: 'FAILED_FINAL',
        errorCode,
        errorMessage: SepError.defaultMessage(errorCode),
        updatedAt: new Date(),
      },
    });
  }
}
