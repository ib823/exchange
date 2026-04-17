You are setting up the Malaysia Secure Exchange Platform in this repository.
The file `sep-platform-body1.zip` has been uploaded to the repo root.
Read and follow every phase in order. Do not skip verification steps.
Do not proceed past a failing step without fixing it first.

---

## PHASE 0 — PREFLIGHT

```bash
node --version        # must be >= 20
docker --version
docker compose version
git --version
```

Install pnpm:

```bash
corepack enable && corepack prepare pnpm@9.0.0 --activate
pnpm --version        # must be >= 9
```

---

## PHASE 1 — EXTRACT ZIP

```bash
# Unzip into repo root (overwrites nothing — zip contains sep-platform/ subfolder)
unzip -o sep-platform-body1.zip

# Move contents up if zip extracted into sep-platform/
if [ -d sep-platform ] && [ ! -f package.json ]; then
  cp -r sep-platform/. .
  rm -rf sep-platform
fi

# Verify critical files exist
for f in package.json pnpm-workspace.yaml turbo.json tsconfig.base.json \
          CLAUDE.md PLANS.md BODY1_EXECUTION.md .env.example \
          docker-compose.yml docker-compose.test.yml .eslintrc.base.js \
          packages/db/prisma/schema.prisma packages/db/prisma/seed.ts; do
  [ -f "$f" ] && echo "OK: $f" || echo "MISSING: $f"
done
```

All files must show OK before continuing.

---

## PHASE 2 — ENVIRONMENT FILE

```bash
cp .env.example .env
```

Open `.env` and set these minimum values for local dev (all others keep defaults):

- `DATABASE_URL=postgresql://sep:sep@localhost:5432/sep_dev`
- `REDIS_URL=redis://localhost:6379`
- `STORAGE_ENDPOINT=http://localhost:9000`
- `STORAGE_ACCESS_KEY=minioadmin`
- `STORAGE_SECRET_KEY=minioadmin`
- `STORAGE_BUCKET_PAYLOADS=sep-payloads`
- `STORAGE_BUCKET_AUDIT_EXPORTS=sep-audit-exports`
- `VAULT_ADDR=http://localhost:8200`
- `VAULT_TOKEN=dev-root-token`
- `JWT_SECRET=dev-jwt-secret-minimum-32-characters-long`
- `REFRESH_TOKEN_SECRET=dev-refresh-secret-min-32-chars-x`
- `INTERNAL_SERVICE_TOKEN=dev-internal-token-minimum-32-chars`
- `WEBHOOK_SIGNING_SECRET=dev-webhook-signing-secret-32-chars`
- `AUDIT_HASH_SECRET=dev-audit-hash-secret-minimum-32-chars`

---

## PHASE 3 — CREATE MISSING SOURCE FILES

The zip contains scaffolding and foundational packages. These source files are
not yet present and must be created now, in this exact order.

### 3.1 packages/schemas/src/shared.schema.ts

```typescript
import { z } from 'zod';

export const EnvironmentSchema = z.enum(['TEST', 'CERTIFICATION', 'PRODUCTION']);
export const RoleSchema = z.enum([
  'PLATFORM_SUPER_ADMIN',
  'TENANT_ADMIN',
  'SECURITY_ADMIN',
  'INTEGRATION_ENGINEER',
  'OPERATIONS_ANALYST',
  'COMPLIANCE_REVIEWER',
]);
export const PartnerTypeSchema = z.enum(['BANK', 'REGULATOR', 'ENTERPRISE', 'ERP_SOURCE']);
export const TransportProtocolSchema = z.enum(['SFTP', 'HTTPS', 'AS2']);
export const MessageSecurityModeSchema = z.enum([
  'NONE',
  'ENCRYPT',
  'SIGN',
  'SIGN_ENCRYPT',
  'VERIFY',
  'DECRYPT',
  'VERIFY_DECRYPT',
]);
export const SubmissionStatusSchema = z.enum([
  'RECEIVED',
  'VALIDATED',
  'QUEUED',
  'PROCESSING',
  'SECURED',
  'SENT',
  'ACK_PENDING',
  'ACK_RECEIVED',
  'COMPLETED',
  'FAILED_RETRYABLE',
  'FAILED_FINAL',
  'CANCELLED',
]);
export const KeyStateSchema = z.enum([
  'DRAFT',
  'IMPORTED',
  'VALIDATED',
  'ACTIVE',
  'ROTATING',
  'EXPIRED',
  'REVOKED',
  'RETIRED',
]);
export const PartnerProfileStatusSchema = z.enum([
  'DRAFT',
  'TEST_READY',
  'TEST_APPROVED',
  'PROD_PENDING_APPROVAL',
  'PROD_ACTIVE',
  'SUSPENDED',
  'RETIRED',
]);
export const ServiceTierSchema = z.enum(['STANDARD', 'DEDICATED', 'PRIVATE']);

export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const CuidSchema = z.string().min(1).max(64);
export const CorrelationIdSchema = z.string().uuid().or(z.string().cuid());
export const IdempotencyKeySchema = z.string().min(1).max(255);
export const TenantIdParamSchema = z.object({ tenantId: CuidSchema });
```

### 3.2 packages/schemas/src/tenant.schema.ts

```typescript
import { z } from 'zod';
import { CuidSchema, ServiceTierSchema } from './shared.schema';

export const CreateTenantSchema = z.object({
  name: z.string().min(2).max(120),
  legalEntityName: z.string().min(2).max(200),
  serviceTier: ServiceTierSchema.default('STANDARD'),
  defaultRegion: z.string().default('ap-southeast-1'),
  metadata: z.record(z.unknown()).optional(),
});

export const UpdateTenantSchema = CreateTenantSchema.partial();

export const TenantResponseSchema = z.object({
  id: CuidSchema,
  name: z.string(),
  legalEntityName: z.string(),
  status: z.string(),
  serviceTier: ServiceTierSchema,
  defaultRegion: z.string(),
  createdAt: z.date().or(z.string()),
  updatedAt: z.date().or(z.string()),
});

export type CreateTenantDto = z.infer<typeof CreateTenantSchema>;
export type UpdateTenantDto = z.infer<typeof UpdateTenantSchema>;
export type TenantResponse = z.infer<typeof TenantResponseSchema>;
```

### 3.3 packages/schemas/src/partner-profile.schema.ts

```typescript
import { z } from 'zod';
import {
  CuidSchema,
  EnvironmentSchema,
  PartnerTypeSchema,
  TransportProtocolSchema,
  MessageSecurityModeSchema,
  PartnerProfileStatusSchema,
} from './shared.schema';

export const SftpConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(22),
  username: z.string().min(1),
  hostKeyFingerprint: z.string().min(1),
  uploadPath: z.string().min(1),
  downloadPath: z.string().min(1),
  privateKeyRef: z.string().optional(),
});

export const HttpsConfigSchema = z.object({
  baseUrl: z.string().url(),
  authType: z.enum(['bearer', 'apiKey', 'mtls', 'none']),
  credentialRef: z.string().optional(),
  certRef: z.string().optional(),
  keyRef: z.string().optional(),
  headers: z.record(z.string()).optional(),
  timeoutMs: z.number().int().positive().default(30000),
});

export const RetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(0).max(10).default(3),
  backoffDelayMs: z.number().int().positive().default(5000),
  backoffMultiplier: z.number().min(1).max(5).default(2),
});

export const CreatePartnerProfileSchema = z.object({
  tenantId: CuidSchema,
  name: z.string().min(2).max(200),
  partnerType: PartnerTypeSchema,
  environment: EnvironmentSchema,
  transportProtocol: TransportProtocolSchema,
  messageSecurityMode: MessageSecurityModeSchema.default('NONE'),
  config: z.object({
    sftp: SftpConfigSchema.optional(),
    https: HttpsConfigSchema.optional(),
    retryPolicy: RetryPolicySchema.optional(),
  }),
  notes: z.string().max(2000).optional(),
  effectiveDate: z.string().datetime().optional(),
  expiryDate: z.string().datetime().optional(),
});

export const UpdatePartnerProfileSchema = CreatePartnerProfileSchema.omit({
  tenantId: true,
  environment: true,
}).partial();

export const PartnerProfileResponseSchema = z.object({
  id: CuidSchema,
  tenantId: CuidSchema,
  name: z.string(),
  partnerType: PartnerTypeSchema,
  environment: EnvironmentSchema,
  status: PartnerProfileStatusSchema,
  transportProtocol: TransportProtocolSchema,
  messageSecurityMode: MessageSecurityModeSchema,
  version: z.number(),
  createdAt: z.date().or(z.string()),
  updatedAt: z.date().or(z.string()),
});

export type CreatePartnerProfileDto = z.infer<typeof CreatePartnerProfileSchema>;
export type UpdatePartnerProfileDto = z.infer<typeof UpdatePartnerProfileSchema>;
export type PartnerProfileResponse = z.infer<typeof PartnerProfileResponseSchema>;
```

### 3.4 packages/schemas/src/submission.schema.ts

```typescript
import { z } from 'zod';
import { CuidSchema, IdempotencyKeySchema, SubmissionStatusSchema } from './shared.schema';

export const CreateSubmissionSchema = z.object({
  tenantId: CuidSchema,
  partnerProfileId: CuidSchema,
  sourceSystemId: CuidSchema.optional(),
  exchangeProfileId: CuidSchema.optional(),
  contentType: z.string().min(1).max(100),
  idempotencyKey: IdempotencyKeySchema,
  payloadRef: z.string().min(1).max(500).optional(),
  normalizedHash: z.string().length(64).optional(),
  payloadSize: z.number().int().positive().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const SubmissionResponseSchema = z.object({
  submissionId: CuidSchema,
  correlationId: z.string(),
  tenantId: CuidSchema,
  status: SubmissionStatusSchema,
  createdAt: z.date().or(z.string()),
});

export const TimelineEventSchema = z.object({
  eventId: CuidSchema,
  action: z.string(),
  actorType: z.string(),
  actorId: z.string(),
  result: z.string(),
  eventTime: z.date().or(z.string()),
  correlationId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type CreateSubmissionDto = z.infer<typeof CreateSubmissionSchema>;
export type SubmissionResponse = z.infer<typeof SubmissionResponseSchema>;
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;
```

### 3.5 packages/schemas/src/key-reference.schema.ts

```typescript
import { z } from 'zod';
import { CuidSchema, EnvironmentSchema, KeyStateSchema } from './shared.schema';

export const KeyUsageSchema = z.enum(['ENCRYPT', 'DECRYPT', 'SIGN', 'VERIFY', 'WRAP', 'UNWRAP']);
export const KeyBackendTypeSchema = z.enum([
  'PLATFORM_VAULT',
  'TENANT_VAULT',
  'EXTERNAL_KMS',
  'SOFTWARE_LOCAL',
]);

export const CreateKeyReferenceSchema = z.object({
  tenantId: CuidSchema,
  partnerProfileId: CuidSchema.optional(),
  name: z.string().min(2).max(200),
  usage: z.array(KeyUsageSchema).min(1),
  backendType: KeyBackendTypeSchema,
  backendRef: z.string().min(1).max(500),
  fingerprint: z.string().min(8).max(128),
  algorithm: z.string().min(1).max(50),
  environment: EnvironmentSchema,
  expiresAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const KeyReferenceResponseSchema = z.object({
  id: CuidSchema,
  tenantId: CuidSchema,
  name: z.string(),
  usage: z.array(KeyUsageSchema),
  backendType: KeyBackendTypeSchema,
  fingerprint: z.string(),
  algorithm: z.string(),
  version: z.number(),
  state: KeyStateSchema,
  environment: EnvironmentSchema,
  activatedAt: z.date().or(z.string()).nullable(),
  expiresAt: z.date().or(z.string()).nullable(),
  createdAt: z.date().or(z.string()),
});

export type CreateKeyReferenceDto = z.infer<typeof CreateKeyReferenceSchema>;
export type KeyReferenceResponse = z.infer<typeof KeyReferenceResponseSchema>;
```

### 3.6 packages/schemas/src/audit.schema.ts

```typescript
import { z } from 'zod';
import { CuidSchema, RoleSchema } from './shared.schema';

export const AuditEventResponseSchema = z.object({
  id: CuidSchema,
  tenantId: CuidSchema,
  actorType: z.enum(['USER', 'SYSTEM', 'SERVICE', 'SCHEDULER']),
  actorId: z.string(),
  actorRole: RoleSchema.nullable(),
  objectType: z.string(),
  objectId: z.string(),
  action: z.string(),
  result: z.enum(['SUCCESS', 'FAILURE']),
  correlationId: z.string().nullable(),
  eventTime: z.date().or(z.string()),
  immutableHash: z.string(),
  metadata: z.record(z.unknown()).nullable(),
});

export const AuditSearchSchema = z.object({
  objectType: z.string().optional(),
  objectId: z.string().optional(),
  action: z.string().optional(),
  actorId: z.string().optional(),
  correlationId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type AuditEventResponse = z.infer<typeof AuditEventResponseSchema>;
export type AuditSearchDto = z.infer<typeof AuditSearchSchema>;
```

### 3.7 packages/schemas/src/index.ts

```typescript
export * from './shared.schema';
export * from './tenant.schema';
export * from './partner-profile.schema';
export * from './submission.schema';
export * from './key-reference.schema';
export * from './audit.schema';
```

### 3.8 packages/partner-profiles/src/profile.validator.ts

```typescript
import { SepError, ErrorCode } from '@sep/common';
import { CreatePartnerProfileSchema, type CreatePartnerProfileDto } from '@sep/schemas';
import type { ZodError } from 'zod';

export function validatePartnerProfile(raw: unknown): CreatePartnerProfileDto {
  const result = CreatePartnerProfileSchema.safeParse(raw);
  if (!result.success) {
    const zodErr = result.error as ZodError;
    throw new SepError(ErrorCode.VALIDATION_SCHEMA_FAILED, {
      issues: zodErr.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const data = result.data;
  // Transport config must match declared protocol
  if (data.transportProtocol === 'SFTP' && data.config.sftp === undefined) {
    throw new SepError(ErrorCode.VALIDATION_SCHEMA_FAILED, {
      field: 'config.sftp',
      message: 'SFTP config required when transportProtocol is SFTP',
    });
  }
  if (data.transportProtocol === 'HTTPS' && data.config.https === undefined) {
    throw new SepError(ErrorCode.VALIDATION_SCHEMA_FAILED, {
      field: 'config.https',
      message: 'HTTPS config required when transportProtocol is HTTPS',
    });
  }
  return data;
}
```

### 3.9 packages/partner-profiles/src/index.ts

```typescript
export * from './profile.validator';
```

### 3.10 apps/control-plane/src/common/decorators/roles.decorator.ts

```typescript
import { SetMetadata } from '@nestjs/common';
import type { Role } from '@sep/common';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]): ReturnType<typeof SetMetadata> =>
  SetMetadata(ROLES_KEY, roles);

export const SkipTenantCheck = (): ReturnType<typeof SetMetadata> =>
  SetMetadata('skipTenantCheck', true);
```

### 3.11 apps/control-plane/src/common/guards/roles.guard.ts

```typescript
import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { SepError, ErrorCode } from '@sep/common';
import type { AuthenticatedRequest } from './tenant.guard';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required === undefined || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (user === undefined) throw new ForbiddenException('No authenticated user');

    if (!required.includes(user.role)) {
      throw new ForbiddenException(
        new SepError(ErrorCode.RBAC_INSUFFICIENT_ROLE, {
          required,
          actual: user.role,
        }).toClientJson(),
      );
    }
    return true;
  }
}
```

### 3.12 apps/control-plane/src/common/filters/http-exception.filter.ts

```typescript
import {
  type ExceptionFilter,
  Catch,
  type ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { isSepError } from '@sep/common';
import { randomUUID } from 'crypto';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const correlationId =
      (request.headers['x-correlation-id'] as string | undefined) ?? randomUUID();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';
    let retryable = false;
    let terminal = false;

    if (isSepError(exception)) {
      const clientJson = exception.toClientJson();
      status = this.sepErrorToHttpStatus(exception.code);
      code = clientJson.code;
      message = clientJson.message;
      retryable = clientJson.retryable;
      terminal = clientJson.terminal;
      // Log full context internally — never sent to client
      this.logger.error({ ...exception.toLogJson(), correlationId }, 'SepError');
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      message =
        typeof resp === 'string'
          ? resp
          : (((resp as Record<string, unknown>)['message'] as string) ?? message);
      this.logger.warn({ status, message, correlationId }, 'HttpException');
    } else {
      this.logger.error({ correlationId, err: exception }, 'Unhandled exception');
    }

    void reply.status(status).send({
      error: { code, message, retryable, terminal, correlationId },
    });
  }

  private sepErrorToHttpStatus(code: string): number {
    if (
      code.startsWith('RBAC_') ||
      code === 'TENANT_BOUNDARY_VIOLATION' ||
      code === 'APPROVAL_SELF_APPROVAL_FORBIDDEN'
    )
      return 403;
    if (code.includes('NOT_FOUND') || code === 'SUBMISSION_NOT_FOUND') return 404;
    if (code === 'VALIDATION_DUPLICATE') return 409;
    if (
      code === 'AUTH_TOKEN_INVALID' ||
      code === 'AUTH_TOKEN_EXPIRED' ||
      code === 'AUTH_API_KEY_INVALID'
    )
      return 401;
    if (code === 'APPROVAL_REQUIRED') return 202;
    if (code.startsWith('VALIDATION_') || code.startsWith('POLICY_')) return 422;
    return 500;
  }
}
```

### 3.13 apps/control-plane/src/common/interceptors/logging.interceptor.ts

```typescript
import {
  Injectable,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { createLogger } from '@sep/observability';
import { randomUUID } from 'crypto';
import type { FastifyRequest } from 'fastify';

const logger = createLogger({ service: 'control-plane', module: 'http' });

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const correlationId = (req.headers['x-correlation-id'] as string | undefined) ?? randomUUID();
    const startMs = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          logger.info(
            { method: req.method, url: req.url, correlationId, durationMs: Date.now() - startMs },
            'Request completed',
          );
        },
        error: (err: unknown) => {
          logger.warn(
            {
              method: req.method,
              url: req.url,
              correlationId,
              durationMs: Date.now() - startMs,
              err,
            },
            'Request failed',
          );
        },
      }),
    );
  }
}
```

### 3.14 apps/control-plane/src/modules/health/health.controller.ts

```typescript
import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Get('live')
  liveness(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  readiness(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
```

### 3.15 apps/control-plane/src/modules/health/health.module.ts

```typescript
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

@Module({ controllers: [HealthController] })
export class HealthModule {}
```

### 3.16 apps/control-plane/src/app.module.ts

```typescript
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
    ThrottlerModule.forRoot([
      {
        ttl: cfg.rateLimit.ttlMs,
        limit: cfg.rateLimit.maxPerWindow,
      },
    ]),
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
```

### 3.17 apps/data-plane/src/queues/queue.definitions.ts

```typescript
// Queue names — single source of truth. Import from here, never hardcode strings.
export const QUEUES = {
  SUBMISSION_ACCEPTED: 'submission.accepted',
  DELIVERY_REQUESTED: 'delivery.requested',
  DELIVERY_COMPLETED: 'delivery.completed',
  DELIVERY_FAILED: 'delivery.failed',
  INBOUND_RECEIVED: 'inbound.received',
  STATUS_NORMALIZED: 'status.normalized',
  INCIDENT_CREATED: 'incident.created',
  KEY_ROTATION_PENDING: 'key.rotation.pending',
  KEY_ROTATION_COMPLETED: 'key.rotation.completed',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

// Dead-letter queue suffix convention
export const DLQ_SUFFIX = '.dlq';
export const dlqName = (queue: QueueName): string => `${queue}${DLQ_SUFFIX}`;

// Default job options — override per profile
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: { count: 100 },
  removeOnFail: false, // Keep failed jobs for inspection
};
```

### 3.18 apps/data-plane/src/processors/intake.processor.ts

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { createLogger } from '@sep/observability';
import { QUEUES } from '../queues/queue.definitions';
import type { SubmissionJob } from '@sep/common';

const logger = createLogger({ service: 'data-plane', module: 'intake' });

@Processor(QUEUES.SUBMISSION_ACCEPTED)
export class IntakeProcessor extends WorkerHost {
  async process(job: Job<SubmissionJob>): Promise<void> {
    const { correlationId, tenantId, submissionId } = job.data;
    logger.info(
      { correlationId, tenantId, submissionId, attempt: job.attemptsMade },
      'Processing intake job',
    );

    // TODO M2: implement full intake pipeline
    // 1. Load partner profile
    // 2. Validate payload against profile schema
    // 3. Verify hash matches stored hash
    // 4. Check duplicate via idempotency key
    // 5. Enqueue delivery.requested job
    // 6. Write audit event: SUBMISSION_QUEUED

    throw new Error('IntakeProcessor.process: not yet implemented — complete in M2');
  }
}
```

### 3.19 apps/data-plane/src/processors/crypto.processor.ts

```typescript
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
    throw new Error('CryptoProcessor.process: not yet implemented — complete in M2');
  }
}
```

### 3.20 apps/data-plane/src/processors/delivery.processor.ts

```typescript
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
    throw new Error('DeliveryProcessor.process: not yet implemented — complete in M2');
  }
}
```

### 3.21 apps/data-plane/src/app.module.ts

```typescript
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
```

### 3.22 apps/data-plane/src/main.ts

```typescript
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { getConfig } from '@sep/common';
import { createLogger, setLogLevel } from '@sep/observability';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const cfg = getConfig();
  setLogLevel(cfg.app.logLevel);
  const logger = createLogger({ service: 'data-plane', module: 'bootstrap' });

  await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });

  logger.info({ env: cfg.app.appEnv }, 'Data plane worker started — listening to queues');
}

void bootstrap();
```

### 3.23 apps/operator-console/src/app/layout.tsx

```tsx
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'SEP Operator Console',
  description: 'Malaysia Secure Exchange Platform — Operator Dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

### 3.24 apps/operator-console/src/app/page.tsx

```tsx
export default function HomePage(): JSX.Element {
  return (
    <main>
      <h1>SEP Operator Console</h1>
      <p>Authentication and dashboard UI — implemented in M4.</p>
    </main>
  );
}
```

### 3.25 apps/operator-console/next.config.ts

```typescript
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  experimental: { typedRoutes: true },
};

export default config;
```

### 3.26 tests/helpers/tenant-boundary.helper.ts

```typescript
/**
 * Tenant boundary test helper.
 *
 * Use in every integration test that exercises a controller method.
 * Verifies that accessing a resource with a mismatched tenantId returns 403,
 * not 200 or 404. A 404 on cross-tenant access would reveal resource existence.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

export interface TenantBoundaryCase {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  ownerTenantId: string;
  ownerToken: string;
  attackerTenantId: string;
  attackerToken: string;
  body?: Record<string, unknown>;
}

export async function assertTenantBoundaryEnforced(
  app: NestFastifyApplication,
  tc: TenantBoundaryCase,
): Promise<void> {
  const { default: supertest } = await import('supertest');
  const server = app.getHttpServer();

  // Owner must be able to access their own resource
  const ownerResponse = await supertest(server)
    [tc.method.toLowerCase() as 'get' | 'post' | 'patch' | 'delete'](tc.url)
    .set('Authorization', `Bearer ${tc.ownerToken}`)
    .send(tc.body);

  if (ownerResponse.status === 404) {
    throw new Error(`Owner got 404 on their own resource: ${tc.url} — seed data may be missing`);
  }

  // Attacker with different tenantId must receive 403, not 200 or 404
  const attackerResponse = await supertest(server)
    [tc.method.toLowerCase() as 'get' | 'post' | 'patch' | 'delete'](tc.url)
    .set('Authorization', `Bearer ${tc.attackerToken}`)
    .send(tc.body);

  if (attackerResponse.status !== 403) {
    throw new Error(
      `TENANT BOUNDARY VIOLATION: ${tc.method} ${tc.url} ` +
        `returned ${attackerResponse.status} for attacker tenant ${tc.attackerTenantId}. ` +
        `Expected 403.`,
    );
  }

  const body = attackerResponse.body as { error?: { code?: string } };
  if (
    body.error?.code !== 'TENANT_BOUNDARY_VIOLATION' &&
    body.error?.code !== 'RBAC_INSUFFICIENT_ROLE'
  ) {
    throw new Error(
      `Expected TENANT_BOUNDARY_VIOLATION error code, got: ${body.error?.code ?? 'none'}`,
    );
  }
}
```

### 3.27 tests/helpers/auth.helper.ts

```typescript
import { sign } from 'jsonwebtoken';

const TEST_JWT_SECRET = 'test-jwt-secret-minimum-32-characters-long';
const TEST_EXPIRY = '1h';

export interface TestUserPayload {
  userId: string;
  tenantId: string;
  role: string;
  email: string;
}

export function makeTestToken(payload: TestUserPayload): string {
  return sign(payload, TEST_JWT_SECRET, {
    expiresIn: TEST_EXPIRY,
    issuer: 'sep-control-plane-test',
  });
}

export const TEST_TENANTS = {
  standard: 'seed-tenant-standard-001',
  dedicated: 'seed-tenant-dedicated-001',
};

export const TEST_USERS = {
  tenantAdmin: {
    userId: 'seed-user-tenant-admin-001',
    tenantId: TEST_TENANTS.standard,
    role: 'TENANT_ADMIN',
    email: 'tenant-admin@sep.local',
  },
  securityAdmin: {
    userId: 'seed-user-security-admin-001',
    tenantId: TEST_TENANTS.standard,
    role: 'SECURITY_ADMIN',
    email: 'security-admin@sep.local',
  },
  operationsAnalyst: {
    userId: 'seed-user-ops-analyst-001',
    tenantId: TEST_TENANTS.standard,
    role: 'OPERATIONS_ANALYST',
    email: 'ops-analyst@sep.local',
  },
  complianceReviewer: {
    userId: 'seed-user-compliance-rev-001',
    tenantId: TEST_TENANTS.standard,
    role: 'COMPLIANCE_REVIEWER',
    email: 'compliance-reviewer@sep.local',
  },
  attackerOtherTenant: {
    userId: 'attacker-user-001',
    tenantId: TEST_TENANTS.dedicated,
    role: 'TENANT_ADMIN',
    email: 'attacker@other-tenant.local',
  },
};

// Pre-built tokens for all test users
export const TEST_TOKENS = Object.fromEntries(
  Object.entries(TEST_USERS).map(([key, user]) => [key, makeTestToken(user)]),
) as Record<keyof typeof TEST_USERS, string>;
```

### 3.28 infra/postgres/rls_audit.sql

```sql
-- Append-only enforcement for audit_events table.
-- Run once after prisma migrate creates the table.
-- Prevents any UPDATE or DELETE on audit records — even by the application user.

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

-- Allow inserts from the application role
CREATE POLICY audit_insert_only
  ON audit_events
  FOR INSERT
  WITH CHECK (true);

-- Revoke UPDATE and DELETE from the application user
-- These will fail silently unless RLS is bypassed (requires superuser)
REVOKE UPDATE ON audit_events FROM sep;
REVOKE DELETE ON audit_events FROM sep;

-- Verify
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'audit_events' AND policyname = 'audit_insert_only'
  ) THEN
    RAISE EXCEPTION 'RLS policy not applied to audit_events';
  END IF;
  RAISE NOTICE 'audit_events RLS verified OK';
END;
$$;
```

---

## PHASE 4 — INSTALL DEPENDENCIES

```bash
pnpm install
```

Verify workspace resolves all 9 packages:

```bash
pnpm ls --depth 0 2>&1 | grep @sep
# Must list: @sep/common, @sep/schemas, @sep/crypto, @sep/observability,
#            @sep/partner-profiles, @sep/db, @sep/control-plane,
#            @sep/data-plane, @sep/operator-console
```

---

## PHASE 5 — GENERATE PRISMA CLIENT

```bash
pnpm --filter @sep/db exec prisma generate
# Must output: Generated Prisma Client
```

---

## PHASE 6 — START INFRASTRUCTURE

```bash
docker compose up -d
sleep 10
docker compose ps
# Every service must be healthy or running — none exited

docker exec sep-postgres pg_isready -U sep -d sep_dev
docker exec sep-redis redis-cli ping
curl -sf http://localhost:9000/minio/health/live && echo "minio ok"
```

---

## PHASE 7 — RUN DATABASE MIGRATION

```bash
pnpm --filter @sep/db exec prisma migrate dev --name init
```

Verify all 17 tables exist:

```bash
docker exec sep-postgres psql -U sep -d sep_dev -c "\dt" | grep -c "public"
# Must output 17 or more
```

Apply audit RLS:

```bash
docker exec -i sep-postgres psql -U sep -d sep_dev < infra/postgres/rls_audit.sql
# Must output: NOTICE:  audit_events RLS verified OK
```

---

## PHASE 8 — SEED DATABASE

```bash
pnpm --filter @sep/db exec prisma db seed
# Must output: Seed complete with entity counts
```

Run seed a second time and verify counts are identical (idempotency check):

```bash
pnpm --filter @sep/db exec prisma db seed
```

---

## PHASE 9 — BUILD

```bash
pnpm build
# Must complete with exit code 0
# Zero TypeScript errors across all packages
```

If any package fails, isolate and fix:

```bash
pnpm --filter @sep/<failing-package> build 2>&1 | head -60
```

---

## PHASE 10 — LINT AND TYPE CHECK

```bash
pnpm lint
# Must exit 0 — zero warnings, zero errors

pnpm typecheck
# Must exit 0 — zero type errors
```

---

## PHASE 11 — UNIT TESTS

```bash
pnpm test:unit
# All suites must pass

# Minimum passing suites:
# packages/common    — ErrorCode, SepError
# packages/crypto    — policy enforcer
# packages/observability — redaction paths
```

---

## PHASE 12 — SECURITY GATE

Run all three checks. All must return zero matches:

```bash
# Check 1: No secrets hardcoded in source files
grep -rn \
  --include="*.ts" --include="*.js" \
  -E "(privateKey\s*[:=]\s*['\"]|passphrase\s*[:=]\s*['\"]|password\s*=\s*['\"][^'\"]{4})" \
  packages/ apps/ \
  --exclude-dir=node_modules \
  --exclude="*.test.ts" \
  --exclude="seed.ts"
echo "Exit $? — must be 1 (no matches)"

# Check 2: No direct process.env access outside config layer
grep -rn "process\.env\." \
  packages/ apps/ \
  --include="*.ts" \
  --exclude-dir=node_modules \
  | grep -v "config\.ts" \
  | grep -v "config/index\.ts" \
  | grep -v "main\.ts"
echo "Exit $? — must be 1 (no matches)"

# Check 3: Audit RLS policy is applied
docker exec sep-postgres psql -U sep -d sep_dev \
  -c "SELECT policyname FROM pg_policies WHERE tablename = 'audit_events';"
# Must show: audit_insert_only
```

---

## PHASE 13 — M0 EXIT CRITERIA CHECKLIST

Before committing, verify every item is checked:

```bash
# Run this script — every line must print OK
checks=(
  "pnpm build:          pnpm build --silent && echo OK || echo FAIL"
  "pnpm lint:           pnpm lint --silent && echo OK || echo FAIL"
  "pnpm typecheck:      pnpm typecheck --silent && echo OK || echo FAIL"
  "pnpm test:unit:      pnpm test:unit --silent && echo OK || echo FAIL"
)
for check in "${checks[@]}"; do
  name="${check%%:*}"
  cmd="${check##*:}"
  printf "%-20s" "$name"
  eval "$cmd"
done
```

---

## PHASE 14 — COMMIT

```bash
git add -A
git status   # review what is staged

git commit -m "feat(m0): complete repository bootstrap

Body 1 scaffold complete:
- pnpm monorepo: 6 packages, 3 apps
- Prisma schema: 17 entities, fixed Approval relations, audit RLS
- Docker Compose: postgres, redis, minio, vault, prometheus, grafana
- TypeScript strict mode across all packages
- ESLint zero-warning policy with no-process-env enforcement
- Pino logger with 30+ sensitive field redaction paths
- Crypto policy enforcer (fail-closed, terminal errors)
- BullMQ queue definitions (9 queues)
- Tenant boundary guard with assertTenantOwnership helper
- Audit append-only RLS applied
- All 6 roles seeded, seed idempotent
- All M0 quality gates pass"
```

Update PLANS.md: set M0 status to COMPLETE, add completion date.

---

## NEXT SESSION

When M0 is complete, start M1 with:

"Read CLAUDE.md. M0 is complete per PLANS.md.
Execute M1: Domain and Control Plane Baseline.
Begin with TenantsModule — implement controller, service, and contract tests.
Follow the NestJS module pattern established in AppModule."
