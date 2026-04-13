/**
 * Delivery processor — handles the delivery stage after crypto.
 *
 * Pipeline:
 * 1. Select transport connector from partner profile
 * 2. Create DeliveryAttempt record (PENDING)
 * 3. Invoke connector
 * 4. Update DeliveryAttempt (SUCCEEDED | FAILED)
 * 5. On success: update Submission to DELIVERED, write audit
 * 6. On failure: evaluate retry eligibility, re-enqueue or fail final
 *
 * Idempotency: if DeliveryAttempt already exists for this submissionId
 * and attemptNumber with status SUCCEEDED, skip.
 */

import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { DatabaseService } from '@sep/db';
import { SepError, ErrorCode, getConfig, RETRYABLE_ERROR_CODES, type DeliveryJob } from '@sep/common';
import { createLogger, deliveryCounter, deliveryRetryCounter } from '@sep/observability';
import { QUEUES } from '../queues/queue.definitions';
import { AuditWriterService } from '../services/audit-writer.service';
import { getConnector, type TransportProtocol } from '../connectors/connector.factory';
import type { ConnectorConfig, DeliveryContext } from '../connectors/connector.interface';

const logger = createLogger({ service: 'data-plane', module: 'delivery' });

@Processor(QUEUES.DELIVERY_COMPLETED)
export class DeliveryProcessor extends WorkerHost {
  private readonly auditWriter: AuditWriterService;

  constructor(
    private readonly database: DatabaseService,
    @InjectQueue(QUEUES.DELIVERY_COMPLETED) private readonly deliveryQueue: Queue,
  ) {
    super();
    this.auditWriter = new AuditWriterService(database);
  }

  async process(job: Job<DeliveryJob>): Promise<void> {
    const { correlationId, tenantId, submissionId, partnerProfileId, securedPayloadRef, connectorType, attempt, actorId } = job.data;

    logger.info(
      { correlationId, tenantId, submissionId, connectorType, attempt },
      'Delivery processing started',
    );

    const db = this.database.forTenant(tenantId);

    // 1. Idempotency check
    const existingAttempt = await db.deliveryAttempt.findFirst({
      where: {
        submissionId,
        attemptNo: attempt,
        result: 'SUCCESS',
      },
    });

    if (existingAttempt) {
      logger.info(
        { correlationId, tenantId, submissionId, attempt },
        'Delivery already succeeded for this attempt — skipping',
      );
      return;
    }

    // 2. Load partner profile (resolve endpoint from profile, not job payload)
    const profile = await db.partnerProfile.findFirst({
      where: { id: partnerProfileId, tenantId },
      select: {
        id: true, transportProtocol: true, environment: true,
        config: true, status: true, retryPolicyRef: true,
      },
    });

    if (!profile) {
      throw new SepError(ErrorCode.RBAC_RESOURCE_NOT_FOUND, {
        tenantId, profileId: partnerProfileId, correlationId,
      });
    }

    // 3. Extract connector config from partner profile (not from job)
    const profileConfig = profile.config as Record<string, unknown> | null;
    const connectorConfig: ConnectorConfig = {
      host: String(profileConfig?.['host'] ?? 'partner.example.com'),
      port: Number(profileConfig?.['port'] ?? (connectorType === 'SFTP' ? 22 : 443)),
      username: profileConfig?.['username'] as string | undefined,
      remotePath: profileConfig?.['remotePath'] as string | undefined,
      hostKeyFingerprint: profileConfig?.['hostKeyFingerprint'] as string | undefined,
      clientCertRef: profileConfig?.['clientCertRef'] as string | undefined,
      caBundleRef: profileConfig?.['caBundleRef'] as string | undefined,
      apiKeyRef: profileConfig?.['apiKeyRef'] as string | undefined,
      timeoutMs: Number(profileConfig?.['timeoutMs'] ?? 30000),
    };

    // 4. Create DeliveryAttempt record before attempting
    const deliveryAttempt = await db.deliveryAttempt.create({
      data: {
        submissionId,
        attemptNo: attempt,
        startedAt: new Date(),
        connectorType: profile.transportProtocol,
        retryEligible: false,
        metadata: { correlationId, actorId },
      },
    });

    // 5. Get connector and deliver
    const connector = getConnector(connectorType as TransportProtocol);
    const context: DeliveryContext = {
      tenantId,
      submissionId,
      correlationId,
      partnerProfileId,
      attemptNumber: attempt,
    };

    const result = await connector.deliver(securedPayloadRef, connectorConfig, context);

    // 6. Update DeliveryAttempt
    await db.deliveryAttempt.update({
      where: { id: deliveryAttempt.id },
      data: {
        completedAt: new Date(),
        result: result.success ? 'SUCCESS' : 'TRANSPORT_FAILURE',
        normalizedErrorCode: result.errorCode ?? null,
        remoteReference: result.remoteReference ?? null,
        durationMs: result.durationMs,
        retryEligible: !result.success,
      },
    });

    if (result.success) {
      // 7a. Success path
      await db.submission.update({
        where: { id: submissionId },
        data: { status: 'SENT', updatedAt: new Date() },
      });

      await this.auditWriter.record({
        tenantId,
        actorType: 'SERVICE',
        actorId,
        objectType: 'Submission',
        objectId: submissionId,
        action: 'SUBMISSION_DELIVERED',
        result: 'SUCCESS',
        correlationId,
        environment: profile.environment,
        metadata: {
          connectorType,
          attempt: String(attempt),
          remoteReference: result.remoteReference ?? '',
          durationMs: String(result.durationMs),
        },
      });

      deliveryCounter.inc({
        partner_profile_id: partnerProfileId,
        connector_type: connectorType,
        result: 'success',
        environment: profile.environment,
      });

      logger.info(
        { correlationId, tenantId, submissionId, connectorType, attempt, status: 'SENT' },
        'Delivery completed successfully',
      );
    } else {
      // 7b. Failure path — evaluate retry
      const cfg = getConfig();
      const maxAttempts = cfg.redis.queue.defaultMaxAttempts;
      const isRetryable = this.isRetryableError(result.errorCode);

      deliveryCounter.inc({
        partner_profile_id: partnerProfileId,
        connector_type: connectorType,
        result: 'failure',
        environment: profile.environment,
      });

      if (isRetryable && attempt < maxAttempts) {
        // Re-enqueue with incremented attempt and exponential backoff
        const backoffMs = cfg.redis.queue.defaultBackoffDelayMs * Math.pow(2, attempt - 1);

        deliveryRetryCounter.inc({
          partner_profile_id: partnerProfileId,
          reason: result.errorCode ?? 'UNKNOWN',
        });

        await db.submission.update({
          where: { id: submissionId },
          data: { status: 'FAILED_RETRYABLE', updatedAt: new Date() },
        });

        await this.auditWriter.record({
          tenantId,
          actorType: 'SERVICE',
          actorId,
          objectType: 'Submission',
          objectId: submissionId,
          action: 'SUBMISSION_RETRIED',
          result: 'SUCCESS',
          correlationId,
          metadata: {
            attempt: String(attempt),
            nextAttempt: String(attempt + 1),
            backoffMs: String(backoffMs),
            errorCode: result.errorCode ?? '',
          },
        });

        const retryJob: DeliveryJob = {
          ...job.data,
          attempt: attempt + 1,
          enqueuedAt: new Date().toISOString(),
        };

        await this.deliveryQueue.add('delivery-retry', retryJob, {
          jobId: `delivery-${submissionId}-${attempt + 1}`,
          delay: backoffMs,
        });

        logger.info(
          { correlationId, tenantId, submissionId, attempt, nextAttempt: attempt + 1, backoffMs },
          'Delivery retry scheduled',
        );
      } else {
        // Terminal failure
        await db.submission.update({
          where: { id: submissionId },
          data: {
            status: 'FAILED_FINAL',
            errorCode: result.errorCode ?? ErrorCode.DELIVERY_FAILED,
            errorMessage: result.errorMessage ?? 'Delivery failed after max attempts',
            updatedAt: new Date(),
          },
        });

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
            attempt: String(attempt),
            errorCode: result.errorCode ?? '',
            reason: isRetryable ? 'max_attempts_exceeded' : 'terminal_error',
          },
        });

        logger.error(
          { correlationId, tenantId, submissionId, attempt, errorCode: result.errorCode },
          'Delivery failed — terminal',
        );
      }
    }
  }

  private isRetryableError(errorCode: string | undefined): boolean {
    if (errorCode === undefined || errorCode === '') {return true;}
    return RETRYABLE_ERROR_CODES.has(errorCode as ErrorCode);
  }
}
