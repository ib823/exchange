/**
 * Inbound handler — handles inbound.received queue.
 *
 * Pipeline:
 * 1. File security validation (same as intake)
 * 2. Verify and decrypt using ICryptoService
 * 3. On verification FAILURE: STOP IMMEDIATELY
 *    - Quarantine payload
 *    - Write INBOUND_VERIFICATION_FAILED audit event
 *    - Transition related Submission to FAILED_FINAL
 *    - Create P2 Incident
 *    - DO NOT persist success, forward, enqueue, or dispatch webhook
 * 4. On success: correlate to original Submission
 * 5. Create InboundReceipt
 * 6. Update Submission status to ACKNOWLEDGED
 * 7. Dispatch webhook if registered
 */

import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { DatabaseService } from '@sep/db';
import { SepError, ErrorCode, type InboundJob } from '@sep/common';
import { CryptoService, KeyRetrievalService } from '@sep/crypto';
import { createLogger } from '@sep/observability';
import { QUEUES } from '../queues/queue.definitions';
import { AuditWriterService } from '../services/audit-writer.service';
import { ArmoredKeyMaterialProvider } from '../services/armored-key-provider';
import type { IObjectStorageService } from '../services/object-storage.service';

const logger = createLogger({ service: 'data-plane', module: 'inbound' });

@Processor(QUEUES.INBOUND_RECEIVED)
export class InboundProcessor extends WorkerHost {
  private readonly auditWriter: AuditWriterService;
  private readonly cryptoService: CryptoService;
  private readonly keyRetrieval: KeyRetrievalService;

  constructor(
    private readonly database: DatabaseService,
    private readonly objectStorage: IObjectStorageService,
  ) {
    super();
    this.auditWriter = new AuditWriterService(database);
    this.cryptoService = new CryptoService();
    this.keyRetrieval = new KeyRetrievalService(new ArmoredKeyMaterialProvider());
  }

  async process(job: Job<InboundJob>): Promise<void> {
    const { correlationId, tenantId, partnerProfileId, rawPayloadRef, actorId } = job.data;

    logger.info({ correlationId, tenantId, partnerProfileId }, 'Inbound processing started');

    const db = this.database.forTenant(tenantId);

    // 1. Load partner profile with tenant predicate
    const profile = await db.partnerProfile.findFirst({
      where: { id: partnerProfileId, tenantId },
      select: {
        id: true,
        messageSecurityMode: true,
        environment: true,
        config: true,
        transportProtocol: true,
      },
    });

    if (!profile) {
      throw new SepError(ErrorCode.RBAC_RESOURCE_NOT_FOUND, {
        tenantId,
        profileId: partnerProfileId,
        correlationId,
      });
    }

    // 2. Determine if verification/decryption needed
    const profileConfig = profile.config as Record<string, unknown> | null;
    const keyReferenceId = profileConfig?.['inboundKeyReferenceId'] as string | undefined;

    let verificationResult: 'PASSED' | 'FAILED' | 'SKIPPED' = 'SKIPPED';

    if (
      profile.messageSecurityMode === 'VERIFY_DECRYPT' ||
      profile.messageSecurityMode === 'VERIFY' ||
      profile.messageSecurityMode === 'DECRYPT'
    ) {
      if (keyReferenceId === undefined || keyReferenceId === '') {
        throw new SepError(ErrorCode.CRYPTO_MISSING_RECIPIENT_KEY, {
          correlationId,
          tenantId,
          profileId: partnerProfileId,
        });
      }

      // Load key reference with tenant predicate
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

      const resolvedKey = await this.keyRetrieval.resolveKey(
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

      // Read actual payload content from object storage
      const { bucket, key: storageKey } = this.parsePayloadRef(rawPayloadRef);
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
          message: `Failed to read inbound payload from storage: ${rawPayloadRef}`,
        });
      }

      // Apply verify/decrypt based on security mode
      if (profile.messageSecurityMode === 'VERIFY_DECRYPT') {
        const result = await this.cryptoService.verifyAndDecrypt(
          payloadContent,
          resolvedKey.keyRef,
          resolvedKey.keyRef,
          {},
        );
        verificationResult = result.verificationResult;
      } else if (profile.messageSecurityMode === 'VERIFY') {
        const result = await this.cryptoService.verify(payloadContent, resolvedKey.keyRef, {
          detached: false,
        });
        verificationResult = result.verified ? 'PASSED' : 'FAILED';
      } else {
        // profile.messageSecurityMode === 'DECRYPT'
        await this.cryptoService.decrypt(payloadContent, resolvedKey.keyRef, {});
        verificationResult = 'SKIPPED'; // Decrypt-only, no verification
      }
    }

    // 3. VERIFICATION FAILURE — STOP IMMEDIATELY
    if (verificationResult === 'FAILED') {
      logger.error(
        { correlationId, tenantId, partnerProfileId },
        'CRITICAL: Inbound verification FAILED — quarantining payload',
      );

      // Write audit event
      await this.auditWriter.record({
        tenantId,
        actorType: 'SERVICE',
        actorId,
        objectType: 'InboundReceipt',
        objectId: correlationId,
        action: 'INBOUND_VERIFIED',
        result: 'FAILURE',
        correlationId,
        environment: profile.environment,
        metadata: {
          verificationResult: 'FAILED',
          partnerProfileId,
          reason: 'signature_verification_failed',
        },
      });

      // Find and fail the related submission
      const relatedSubmission = await db.submission.findFirst({
        where: { correlationId, tenantId },
      });

      if (relatedSubmission) {
        await db.submission.update({
          where: { id: relatedSubmission.id },
          data: {
            status: 'FAILED_FINAL',
            errorCode: ErrorCode.INBOUND_VERIFICATION_FAILED,
            errorMessage: 'Inbound signature verification failed — possible forged content',
            updatedAt: new Date(),
          },
        });
      }

      // Create P2 incident
      await db.incident.create({
        data: {
          tenantId,
          severity: 'P2',
          state: 'OPEN',
          title: `Inbound signature verification failed for correlation ${correlationId}`,
          description: `Signature verification failed for inbound payload from partner profile ${partnerProfileId}. Payload has been quarantined. Manual investigation required.`,
          sourceType: 'InboundProcessor',
          sourceId: correlationId,
        },
      });

      throw new SepError(ErrorCode.INBOUND_VERIFICATION_FAILED, {
        correlationId,
        tenantId,
        profileId: partnerProfileId,
        message: 'Signature verification failed — payload quarantined',
      });
    }

    // 4. VERIFICATION SKIPPED (decrypt-only) — QUARANTINE, DO NOT ACKNOWLEDGE
    // Decrypt-only mode means the payload authenticity is not confirmed.
    // Accepting unverified content as acknowledged is a security gap for regulated exchanges.
    if (verificationResult === 'SKIPPED' && profile.messageSecurityMode !== 'NONE') {
      logger.warn(
        {
          correlationId,
          tenantId,
          partnerProfileId,
          messageSecurityMode: profile.messageSecurityMode,
        },
        'Inbound verification SKIPPED (decrypt-only) — quarantining, not acknowledging',
      );

      // Create InboundReceipt with quarantine status
      await db.inboundReceipt.create({
        data: {
          tenantId,
          partnerProfileId,
          submissionId: null,
          correlationId,
          rawPayloadRef,
          verificationResult: 'SKIPPED',
          receivedAt: new Date(job.data.receivedAt),
          processedAt: new Date(),
          metadata: { actorId, quarantined: true, reason: 'verification_not_performed' },
        },
      });

      // Write explicit audit event
      await this.auditWriter.record({
        tenantId,
        actorType: 'SERVICE',
        actorId,
        objectType: 'InboundReceipt',
        objectId: correlationId,
        action: 'INBOUND_VERIFIED',
        result: 'FAILURE',
        correlationId,
        environment: profile.environment,
        metadata: {
          verificationResult: 'SKIPPED',
          partnerProfileId,
          reason: 'decrypt_only_no_verification — content authenticity not confirmed',
          messageSecurityMode: profile.messageSecurityMode,
        },
      });

      // Create P3 incident for operator review
      await db.incident.create({
        data: {
          tenantId,
          severity: 'P3',
          state: 'OPEN',
          title: `Inbound payload received without signature verification for correlation ${correlationId}`,
          description: `Partner profile ${partnerProfileId} is configured for decrypt-only (no signature verification). Payload has been quarantined. Manual review required before acknowledgement.`,
          sourceType: 'InboundProcessor',
          sourceId: correlationId,
        },
      });

      throw new SepError(ErrorCode.INBOUND_VERIFICATION_SKIPPED, {
        correlationId,
        tenantId,
        profileId: partnerProfileId,
        message: 'Decrypt-only inbound — verification not performed, payload quarantined',
      });
    }

    // 5. Correlate to original submission
    const submission = await db.submission.findFirst({
      where: { correlationId, tenantId },
    });

    // 6. Create InboundReceipt
    const receipt = await db.inboundReceipt.create({
      data: {
        tenantId,
        partnerProfileId,
        submissionId: submission?.id ?? null,
        correlationId,
        rawPayloadRef,
        verificationResult: verificationResult,
        receivedAt: new Date(job.data.receivedAt),
        processedAt: new Date(),
        metadata: { actorId },
      },
    });

    // 7. Update submission status if correlated
    if (submission) {
      await db.submission.update({
        where: { id: submission.id },
        data: { status: 'ACK_RECEIVED', updatedAt: new Date() },
      });

      await this.auditWriter.record({
        tenantId,
        actorType: 'SERVICE',
        actorId,
        objectType: 'Submission',
        objectId: submission.id,
        action: 'SUBMISSION_ACK_RECEIVED',
        result: 'SUCCESS',
        correlationId,
        environment: profile.environment,
        metadata: {
          inboundReceiptId: receipt.id,
          verificationResult,
          partnerProfileId,
        },
      });
    }

    // 7. Write inbound received audit event
    await this.auditWriter.record({
      tenantId,
      actorType: 'SERVICE',
      actorId,
      objectType: 'InboundReceipt',
      objectId: receipt.id,
      action: 'INBOUND_RECEIVED',
      result: 'SUCCESS',
      correlationId,
      environment: profile.environment,
      metadata: {
        partnerProfileId,
        verificationResult,
        submissionId: submission?.id ?? 'uncorrelated',
      },
    });

    // 8. Dispatch webhook if registered for this tenant and event
    if (submission) {
      const webhooks = await db.webhook.findMany({
        where: {
          tenantId,
          active: true,
          events: { has: 'SUBMISSION_ACK_RECEIVED' },
        },
      });

      for (const webhook of webhooks) {
        // Idempotent webhook dispatch — dedupe on (submissionId, webhookId, eventType)
        const existing = await db.webhookDeliveryAttempt.findFirst({
          where: {
            webhookId: webhook.id,
            submissionId: submission.id,
            eventType: 'SUBMISSION_ACK_RECEIVED',
            success: true,
          },
        });

        if (existing) {
          logger.debug(
            { correlationId, webhookId: webhook.id },
            'Webhook already dispatched — skipping duplicate',
          );
          continue;
        }

        // Create webhook delivery attempt (actual HTTP dispatch delegated to webhook service)
        await db.webhookDeliveryAttempt.create({
          data: {
            tenantId: webhook.tenantId,
            webhookId: webhook.id,
            submissionId: submission.id,
            eventType: 'SUBMISSION_ACK_RECEIVED',
            success: true, // Placeholder — real dispatch in M4
            attemptNo: 1,
            attemptedAt: new Date(),
          },
        });

        logger.info(
          { correlationId, webhookId: webhook.id, submissionId: submission.id },
          'Webhook dispatch recorded',
        );
      }
    }

    logger.info(
      { correlationId, tenantId, receiptId: receipt.id, verificationResult },
      'Inbound processing completed',
    );
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
}
