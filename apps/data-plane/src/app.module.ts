import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { getConfig } from '@sep/common';
import { QUEUES, DEFAULT_JOB_OPTIONS } from './queues/queue.definitions';
import { IntakeProcessor } from './processors/intake.processor';
import { CryptoProcessor } from './processors/crypto.processor';
import { DeliveryProcessor } from './processors/delivery.processor';

const cfg = getConfig();

const registeredQueues = Object.values(QUEUES).map((name) =>
  BullModule.registerQueue({ name, defaultJobOptions: DEFAULT_JOB_OPTIONS }),
);

@Module({
  imports: [
    BullModule.forRoot({ connection: { url: cfg.redis.url }, prefix: cfg.redis.keyPrefix }),
    ...registeredQueues,
  ],
  providers: [IntakeProcessor, CryptoProcessor, DeliveryProcessor],
})
export class AppModule {}
