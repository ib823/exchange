import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { getConfig } from '@sep/common';
import { HealthModule } from './modules/health/health.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

const cfg = getConfig();

@Module({
  imports: [
    ThrottlerModule.forRoot([{
      ttl: cfg.rateLimit.ttlMs,
      limit: cfg.rateLimit.maxPerWindow,
    }]),
    HealthModule,
    // M1 modules added here as implemented:
    // TenantsModule, PartnerProfilesModule, SubmissionsModule,
    // KeyReferencesModule, IncidentsModule, AuditModule,
    // WebhooksModule, ApprovalsModule, AuthModule
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
