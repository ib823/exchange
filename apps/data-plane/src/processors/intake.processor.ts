import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { createLogger } from '@sep/observability';
import { QUEUES } from '../queues/queue.definitions';
import type { SubmissionJob } from '@sep/common';

const logger = createLogger({ service: 'data-plane', module: 'intake' });

@Processor(QUEUES.SUBMISSION_ACCEPTED)
export class IntakeProcessor extends WorkerHost {
  async process(job: Job<SubmissionJob>): Promise<void> {
    const { correlationId, tenantId, submissionId } = job.data;
    logger.info({ correlationId, tenantId, submissionId, attempt: job.attemptsMade }, 'Processing intake job');

    // TODO M2: implement full intake pipeline
    // 1. Load partner profile
    // 2. Validate payload against profile schema
    // 3. Verify hash matches stored hash
    // 4. Check duplicate via idempotency key
    // 5. Enqueue delivery.requested job
    // 6. Write audit event: SUBMISSION_QUEUED

    await Promise.resolve();
    throw new Error('IntakeProcessor.process: not yet implemented — complete in M2');
  }
}
