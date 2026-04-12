import { Injectable } from '@nestjs/common';
import { HealthIndicator, type HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { getPrismaClient } from '@sep/db';

@Injectable()
export class DatabaseHealthIndicator extends HealthIndicator {
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await getPrismaClient().$queryRaw`SELECT 1`;
      return this.getStatus(key, true);
    } catch (err) {
      throw new HealthCheckError(
        'Database health check failed',
        this.getStatus(key, false, { error: String(err) }),
      );
    }
  }
}
