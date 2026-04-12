import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { createLogger } from '@sep/observability';
import { QUEUES } from '../queues/queue.definitions';
import type { CryptoJob } from '@sep/common';

const logger = createLogger({ service: 'data-plane', module: 'crypto' });

@Processor(QUEUES.DELIVERY_REQUESTED)
export class CryptoProcessor extends WorkerHost {
  async process(job: Job<CryptoJob>): Promise<void> {
    const { correlationId, tenantId, operation } = job.data;
    logger.info({ correlationId, tenantId, operation }, 'Processing crypto job');
    // TODO M2: load key ref, enforce policy, apply operation, enqueue delivery
    await Promise.resolve();
    throw new Error('CryptoProcessor.process: not yet implemented — complete in M2');
  }
}
