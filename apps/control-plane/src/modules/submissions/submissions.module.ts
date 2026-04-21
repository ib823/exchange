import { Module } from '@nestjs/common';
import Redis from 'ioredis';
import { getConfig } from '@sep/common';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';
import { SubmissionQuotaService, SUBMISSION_QUOTA_REDIS } from './submission-quota.service';

const cfg = getConfig();

@Module({
  controllers: [SubmissionsController],
  providers: [
    SubmissionsService,
    SubmissionQuotaService,
    {
      // Dedicated Redis client for the quota counter. Isolated from
      // the throttler + edge rate-limit + MFA clients so a burst on
      // one layer doesn't starve the others.
      provide: SUBMISSION_QUOTA_REDIS,
      useFactory: (): Redis =>
        new Redis(cfg.redis.url, {
          keyPrefix: 'sep:',
          lazyConnect: false,
          maxRetriesPerRequest: 3,
        }),
    },
  ],
  exports: [SubmissionsService, SubmissionQuotaService],
})
export class SubmissionsModule {}
