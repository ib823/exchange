import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_GUARD, Reflector } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { JwtModule } from '@nestjs/jwt';
import { getConfig } from '@sep/common';
import { HealthModule } from './modules/health/health.module';
import { DatabaseModule } from './modules/database/database.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { PartnerProfilesModule } from './modules/partner-profiles/partner-profiles.module';
import { SubmissionsModule } from './modules/submissions/submissions.module';
import { KeyReferencesModule } from './modules/key-references/key-references.module';
import { IncidentsModule } from './modules/incidents/incidents.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { TenantGuard } from './common/guards/tenant.guard';

const cfg = getConfig();

@Module({
  imports: [
    ThrottlerModule.forRoot([{
      ttl: cfg.rateLimit.ttlMs,
      limit: cfg.rateLimit.maxPerWindow,
    }]),
    JwtModule.register({
      secret: cfg.auth.jwtSecret,
      signOptions: { expiresIn: cfg.auth.jwtExpiry as `${number}m`, issuer: cfg.auth.jwtIssuer, algorithm: 'HS256' },
      verifyOptions: { algorithms: ['HS256'] },
    }),
    DatabaseModule,
    AuditModule,
    AuthModule,
    TenantsModule,
    PartnerProfilesModule,
    SubmissionsModule,
    KeyReferencesModule,
    IncidentsModule,
    ApprovalsModule,
    WebhooksModule,
    HealthModule,
  ],
  providers: [
    Reflector,
    // Order matters: auth first, then tenant boundary, then roles
    { provide: APP_FILTER,      useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_GUARD,       useClass: ThrottlerGuard },
    { provide: APP_GUARD,       useClass: JwtAuthGuard },
    { provide: APP_GUARD,       useClass: TenantGuard },
    { provide: APP_GUARD,       useClass: RolesGuard },
  ],
})
export class AppModule {}
