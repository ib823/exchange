import { Injectable } from '@nestjs/common';
import { HealthIndicator, type HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { DatabaseService } from '@sep/db';

@Injectable()
export class DatabaseHealthIndicator extends HealthIndicator {
  constructor(private readonly database: DatabaseService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.database.forSystem().$queryRaw`SELECT 1`;
      return this.getStatus(key, true);
    } catch (err) {
      throw new HealthCheckError(
        'Database health check failed',
        this.getStatus(key, false, { error: String(err) }),
      );
    }
  }
}
