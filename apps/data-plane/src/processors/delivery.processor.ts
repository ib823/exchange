import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { createLogger } from '@sep/observability';
import { QUEUES } from '../queues/queue.definitions';
import type { DeliveryJob } from '@sep/common';

const logger = createLogger({ service: 'data-plane', module: 'delivery' });

@Processor(QUEUES.DELIVERY_COMPLETED)
export class DeliveryProcessor extends WorkerHost {
  async process(job: Job<DeliveryJob>): Promise<void> {
    const { correlationId, tenantId, connectorType } = job.data;
    logger.info({ correlationId, tenantId, connectorType }, 'Processing delivery job');
    // TODO M2: invoke connector, record DeliveryAttempt, handle ack
    await Promise.resolve();
    throw new Error('DeliveryProcessor.process: not yet implemented — complete in M2');
  }
}
