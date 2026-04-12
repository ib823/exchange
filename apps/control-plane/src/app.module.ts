import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_GUARD, Reflector } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { JwtModule } from '@nestjs/jwt';
import { getConfig } from '@sep/common';
import { HealthModule } from './modules/health/health.module';
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
      signOptions: { expiresIn: cfg.auth.jwtExpiry, issuer: cfg.auth.jwtIssuer },
    }),
    HealthModule,
    // M1 modules added here as each is implemented and tested:
    // AuthModule, TenantsModule, PartnerProfilesModule, SubmissionsModule,
    // KeyReferencesModule, IncidentsModule, AuditModule,
    // WebhooksModule, ApprovalsModule
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
