/**
 * Crypto processor — handles delivery.requested queue (crypto stage).
 *
 * Pipeline:
 * 1. Load PartnerProfile with tenantId predicate
 * 2. Resolve KeyReference via KeyRetrievalService
 * 3. Apply crypto operation via ICryptoService
 * 4. Write CryptoOperationRecord
 * 5. Update submission to SECURED
 * 6. Enqueue to delivery stage
 * 7. Write audit event SUBMISSION_CRYPTO_APPLIED
 *
 * Idempotency: if CryptoOperationRecord already exists with SUCCESS for this
 * submissionId, skip crypto and proceed to delivery.
 */

import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { DatabaseService, type Prisma } from '@sep/db';
import { SepError, ErrorCode, type CryptoJob, type DeliveryJob } from '@sep/common';
import { CryptoService, KeyRetrievalService, DEFAULT_ALGORITHM_POLICY } from '@sep/crypto';
import { createLogger, cryptoOperationCounter, cryptoFailureCounter } from '@sep/observability';
import { QUEUES } from '../queues/queue.definitions';
import { AuditWriterService } from '../services/audit-writer.service';
import { CryptoRecordService } from '../services/crypto-record.service';
import type { IObjectStorageService } from '../services/object-storage.service';
import { ArmoredKeyMaterialProvider } from '../services/armored-key-provider';

const logger = createLogger({ service: 'data-plane', module: 'crypto' });

@Processor(QUEUES.DELIVERY_REQUESTED)
export class CryptoProcessor extends WorkerHost {
  private readonly auditWriter: AuditWriterService;
  private readonly cryptoRecord: CryptoRecordService;
  private readonly cryptoService: CryptoService;
  private readonly keyRetrieval: KeyRetrievalService;

  constructor(
    private readonly database: DatabaseService,
    @InjectQueue(QUEUES.DELIVERY_COMPLETED) private readonly deliveryQueue: Queue,
    private readonly objectStorage: IObjectStorageService,
  ) {
    super();
    this.auditWriter = new AuditWriterService(database);
    this.cryptoRecord = new CryptoRecordService(database);
    this.cryptoService = new CryptoService();
    this.keyRetrieval = new KeyRetrievalService(new ArmoredKeyMaterialProvider());
  }

  async process(job: Job<CryptoJob>): Promise<void> {
    const {
      correlationId,
      tenantId,
      submissionId,
      partnerProfileId,
      operation,
      keyReferenceId,
      payloadRef,
      actorId,
    } = job.data;

    logger.info({ correlationId, tenantId, submissionId, operation }, 'Crypto processing started');

    await this.database.forTenant(tenantId, async (db) => {
      // 1. Idempotency check: skip if already successfully processed
      const alreadyProcessed = await this.cryptoRecord.existsForSubmission(
        tenantId,
        submissionId,
        operation,
      );
      if (alreadyProcessed) {
        logger.info(
          { correlationId, tenantId, submissionId, operation },
          'Crypto already applied — skipping',
        );
        await this.enqueueDelivery(job.data);
        return;
      }

      // 2. Load partner profile with tenant predicate
      const profile = await db.partnerProfile.findFirst({
        where: { id: partnerProfileId, tenantId },
        select: { id: true, environment: true, transportProtocol: true, config: true },
      });

      if (!profile) {
        throw new SepError(ErrorCode.RBAC_RESOURCE_NOT_FOUND, {
          tenantId,
          profileId: partnerProfileId,
          correlationId,
        });
      }

      // 3. Load key reference with tenant predicate
      const keyRow = await db.keyReference.findFirst({
        where: { id: keyReferenceId, tenantId },
      });

      if (!keyRow) {
        throw new SepError(ErrorCode.CRYPTO_KEY_NOT_FOUND, {
          keyReferenceId,
          tenantId,
          correlationId,
        });
      }

      // 4. Resolve and validate key
      let resolvedKey;
      try {
        resolvedKey = await this.keyRetrieval.resolveKey(
          {
            id: keyRow.id,
            tenantId: keyRow.tenantId,
            partnerProfileId: keyRow.partnerProfileId,
            name: keyRow.name,
            usage: keyRow.usage,
            backendType: keyRow.backendType,
            backendRef: keyRow.backendRef,
            fingerprint: keyRow.fingerprint,
            algorithm: keyRow.algorithm,
            version: keyRow.version,
            state: keyRow.state,
            environment: keyRow.environment,
            activatedAt: keyRow.activatedAt,
            expiresAt: keyRow.expiresAt,
            revokedAt: keyRow.revokedAt,
          },
          profile.environment,
        );
      } catch (err) {
        cryptoFailureCounter.inc({
          operation,
          error_code: err instanceof SepError ? err.code : 'UNKNOWN',
        });
        // Crypto key failures are terminal — no retry
        await this.failSubmission(
          db,
          submissionId,
          tenantId,
          err instanceof SepError ? err.code : ErrorCode.CRYPTO_KEY_INVALID_STATE,
        );
        throw err;
      }

      // 5. Read actual payload bytes from object storage
      const { bucket, key: storageKey } = this.parsePayloadRef(payloadRef);
      let payloadContent: string;
      try {
        const rawBytes = await this.objectStorage.getObject(bucket, storageKey);
        payloadContent = rawBytes.toString('utf-8');
      } catch (err) {
        if (err instanceof SepError) {
          throw err;
        }
        throw new SepError(ErrorCode.STORAGE_DOWNLOAD_FAILED, {
          correlationId,
          message: `Failed to read payload from storage: ${payloadRef}`,
        });
      }

      // 6. Apply crypto operation on actual payload content
      const policy = DEFAULT_ALGORITHM_POLICY;
      let securedPayloadRef: string;

      try {
        switch (operation) {
          case 'ENCRYPT': {
            const result = await this.cryptoService.encrypt(
              payloadContent,
              resolvedKey.keyRef,
              { outputFormat: 'armored', compressionAlgorithm: 'zlib' },
              policy,
            );
            securedPayloadRef = await this.writeSecuredPayload(
              bucket,
              submissionId,
              operation,
              result.encryptedPayloadRef,
            );
            await this.persistRecord(
              tenantId,
              submissionId,
              result.meta,
              policy,
              'SUCCESS',
              correlationId,
              actorId,
              resolvedKey.fingerprint,
            );
            break;
          }
          case 'SIGN': {
            const result = await this.cryptoService.sign(
              payloadContent,
              resolvedKey.keyRef,
              { outputFormat: 'armored', detached: false },
              policy,
            );
            securedPayloadRef = await this.writeSecuredPayload(
              bucket,
              submissionId,
              operation,
              result.signedPayloadRef,
            );
            await this.persistRecord(
              tenantId,
              submissionId,
              result.meta,
              policy,
              'SUCCESS',
              correlationId,
              actorId,
              resolvedKey.fingerprint,
            );
            break;
          }
          case 'SIGN_ENCRYPT': {
            const result = await this.cryptoService.signAndEncrypt(
              payloadContent,
              resolvedKey.keyRef,
              resolvedKey.keyRef,
              { outputFormat: 'armored', detached: false },
              { outputFormat: 'armored', compressionAlgorithm: 'zlib' },
              policy,
            );
            securedPayloadRef = await this.writeSecuredPayload(
              bucket,
              submissionId,
              operation,
              result.securedPayloadRef,
            );
            await this.persistRecord(
              tenantId,
              submissionId,
              result.signMeta,
              policy,
              'SUCCESS',
              correlationId,
              actorId,
              resolvedKey.fingerprint,
            );
            break;
          }
          case 'DECRYPT': {
            const result = await this.cryptoService.decrypt(payloadContent, resolvedKey.keyRef, {});
            securedPayloadRef = await this.writeSecuredPayload(
              bucket,
              submissionId,
              operation,
              result.decryptedPayloadRef,
            );
            await this.persistRecord(
              tenantId,
              submissionId,
              result.meta,
              policy,
              'SUCCESS',
              correlationId,
              actorId,
              resolvedKey.fingerprint,
            );
            break;
          }
          case 'VERIFY': {
            const result = await this.cryptoService.verify(payloadContent, resolvedKey.keyRef, {
              detached: false,
            });
            if (!result.verified) {
              cryptoFailureCounter.inc({
                operation: 'VERIFY',
                error_code: ErrorCode.CRYPTO_VERIFICATION_FAILED,
              });
              await this.failSubmission(
                db,
                submissionId,
                tenantId,
                ErrorCode.CRYPTO_VERIFICATION_FAILED,
              );
              throw new SepError(ErrorCode.CRYPTO_VERIFICATION_FAILED, {
                submissionId,
                correlationId,
              });
            }
            securedPayloadRef = payloadRef; // Verified original — no new content to write
            await this.persistRecord(
              tenantId,
              submissionId,
              result.meta,
              policy,
              'SUCCESS',
              correlationId,
              actorId,
              resolvedKey.fingerprint,
            );
            break;
          }
          case 'VERIFY_DECRYPT': {
            const result = await this.cryptoService.verifyAndDecrypt(
              payloadContent,
              resolvedKey.keyRef,
              resolvedKey.keyRef,
              {},
            );
            if (result.verificationResult === 'FAILED') {
              cryptoFailureCounter.inc({
                operation: 'VERIFY_DECRYPT',
                error_code: ErrorCode.CRYPTO_VERIFICATION_FAILED,
              });
              await this.failSubmission(
                db,
                submissionId,
                tenantId,
                ErrorCode.CRYPTO_VERIFICATION_FAILED,
              );
              throw new SepError(ErrorCode.CRYPTO_VERIFICATION_FAILED, {
                submissionId,
                correlationId,
              });
            }
            securedPayloadRef = await this.writeSecuredPayload(
              bucket,
              submissionId,
              operation,
              result.decryptedPayloadRef,
            );
            await this.persistRecord(
              tenantId,
              submissionId,
              result.decryptMeta,
              policy,
              'SUCCESS',
              correlationId,
              actorId,
              resolvedKey.fingerprint,
            );
            break;
          }
          default: {
            const _exhaustive: never = operation;
            throw new SepError(ErrorCode.INTERNAL_ERROR, { operation: String(_exhaustive) });
          }
        }
      } catch (err) {
        if (err instanceof SepError && err.terminal) {
          // Terminal crypto errors — no retry
          cryptoFailureCounter.inc({ operation, error_code: err.code });
          await this.failSubmission(db, submissionId, tenantId, err.code);
          throw err;
        }
        throw err;
      }

      cryptoOperationCounter.inc({ operation, result: 'success' });

      // 6. Update submission to SECURED
      await db.submission.update({
        where: { id: submissionId },
        data: { status: 'SECURED', updatedAt: new Date() },
      });

      // 7. Write audit event
      await this.auditWriter.record({
        tenantId,
        actorType: 'SERVICE',
        actorId,
        objectType: 'Submission',
        objectId: submissionId,
        action: 'SUBMISSION_CRYPTO_APPLIED',
        result: 'SUCCESS',
        correlationId,
        environment: profile.environment,
        metadata: {
          operation,
          keyReferenceId,
          keyFingerprint: resolvedKey.fingerprint,
        },
      });

      // 8. Enqueue for delivery
      await this.enqueueDelivery({
        ...job.data,
        securedPayloadRef,
        connectorType: profile.transportProtocol,
      } as unknown as CryptoJob);

      logger.info(
        { correlationId, tenantId, submissionId, operation, status: 'SECURED' },
        'Crypto processing completed',
      );
    });
  }

  private async enqueueDelivery(jobData: CryptoJob): Promise<void> {
    const deliveryJob: DeliveryJob = {
      jobId: `delivery-${jobData.submissionId}`,
      correlationId: jobData.correlationId,
      tenantId: jobData.tenantId,
      submissionId: jobData.submissionId,
      partnerProfileId: jobData.partnerProfileId,
      payloadRef: jobData.payloadRef,
      normalizedHash: jobData.normalizedHash,
      attempt: 1,
      enqueuedAt: new Date().toISOString(),
      actorId: jobData.actorId,
      actorRole: jobData.actorRole,
      credentialId: jobData.credentialId,
      securedPayloadRef: (jobData as unknown as DeliveryJob).securedPayloadRef,
      connectorType: (jobData as unknown as DeliveryJob).connectorType,
    };

    await this.deliveryQueue.add('delivery', deliveryJob, {
      jobId: `delivery-${jobData.submissionId}`,
    });
  }

  private async persistRecord(
    tenantId: string,
    submissionId: string,
    meta: { operationId: string; operation: string; keyReferenceId: string; performedAt: Date },
    policy: unknown,
    result: 'SUCCESS' | 'FAILURE' | 'POLICY_VIOLATION',
    correlationId: string,
    actorId: string,
    keyFingerprint: string,
  ): Promise<void> {
    await this.cryptoRecord.persist({
      tenantId,
      submissionId,
      meta: meta as Parameters<typeof this.cryptoRecord.persist>[0]['meta'],
      policy: policy as Parameters<typeof this.cryptoRecord.persist>[0]['policy'],
      result,
      correlationId,
      actorId,
      keyFingerprint,
    });
  }

  private parsePayloadRef(ref: string): { bucket: string; key: string } {
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

  private async writeSecuredPayload(
    bucket: string,
    submissionId: string,
    operation: string,
    cryptoOutput: string,
  ): Promise<string> {
    const securedKey = `secured/${submissionId}/${operation.toLowerCase()}`;
    try {
      await this.objectStorage.putObject(bucket, securedKey, Buffer.from(cryptoOutput, 'utf-8'));
    } catch (err) {
      if (err instanceof SepError) {
        throw err;
      }
      throw new SepError(ErrorCode.STORAGE_UPLOAD_FAILED, {
        message: 'Failed to write secured payload to storage',
      });
    }
    return `s3://${bucket}/${securedKey}`;
  }

  private async failSubmission(
    db: Prisma.TransactionClient,
    submissionId: string,
    _tenantId: string,
    errorCode: string,
  ): Promise<void> {
    await db.submission.update({
      where: { id: submissionId },
      data: {
        status: 'FAILED_FINAL',
        errorCode,
        errorMessage: `Crypto operation failed: ${errorCode}`,
        updatedAt: new Date(),
      },
    });
  }
}
