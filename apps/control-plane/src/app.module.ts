import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_GUARD, Reflector } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { JwtModule } from '@nestjs/jwt';
import Redis from 'ioredis';
import { getConfig } from '@sep/common';
import { SepThrottlerGuard } from './common/guards/sep-throttler.guard';
import { THROTTLER_NAMES, loginEmailTracker, mfaChallengeTracker } from './common/throttler-config';
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
import { CryptoCustodyModule } from './modules/crypto-custody/crypto-custody.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { TenantGuard } from './common/guards/tenant.guard';

const cfg = getConfig();

@Module({
  imports: [
    // M3.A7-T02 — Redis-backed multi-tier throttler.
    // - default: per-IP (or per-API-key once JWT auth guard sets it),
    //   ceiling for general traffic.
    // - authLogin: pre-auth, per-(IP, email) tuple. email pulled from
    //   request.body; falls back to a per-IP bucket on malformed input
    //   (see loginEmailTracker).
    // - mfaVerify: per-challengeToken. One challenge gets at most N
    //   verify attempts regardless of IP; the challenge is single-use
    //   anyway but this caps probe volume while the challenge is live.
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: THROTTLER_NAMES.default,
          ttl: cfg.rateLimit.ttlMs,
          limit: cfg.rateLimit.maxPerWindow,
        },
        {
          name: THROTTLER_NAMES.authLogin,
          ttl: cfg.rateLimit.authLoginTtlMs,
          limit: cfg.rateLimit.authLoginLimit,
          getTracker: loginEmailTracker,
        },
        {
          name: THROTTLER_NAMES.mfaVerify,
          ttl: cfg.rateLimit.mfaVerifyTtlMs,
          limit: cfg.rateLimit.mfaVerifyLimit,
          getTracker: mfaChallengeTracker,
        },
      ],
      storage: new ThrottlerStorageRedisService(
        new Redis(cfg.redis.url, {
          keyPrefix: 'sep:throttler:',
          lazyConnect: false,
          maxRetriesPerRequest: 3,
        }),
      ),
    }),
    JwtModule.register({
      secret: cfg.auth.jwtSecret,
      signOptions: {
        expiresIn: cfg.auth.jwtExpiry as `${number}m`,
        issuer: cfg.auth.jwtIssuer,
        algorithm: 'HS256',
      },
      verifyOptions: { algorithms: ['HS256'] },
    }),
    DatabaseModule,
    AuditModule,
    AuthModule,
    CryptoCustodyModule,
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
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_GUARD, useClass: SepThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
