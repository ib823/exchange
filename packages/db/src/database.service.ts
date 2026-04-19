import { PrismaClient, Prisma } from '@prisma/client';
import { ErrorCode, SepError } from '@sep/common';
import { CuidSchema } from '@sep/schemas';

/**
 * Tenant-scoped database accessor.
 *
 * Every database interaction from the application must go through this service.
 * forTenant() opens a Prisma $transaction, sets `app.current_tenant_id` via
 * Postgres `set_config(...)`, and invokes the caller's callback with the
 * transactional client. RLS policies on every tenant-scoped table reference
 * `current_setting('app.current_tenant_id', true)` so queries inside the
 * callback are tenant-scoped at the DB layer.
 *
 * Why a callback (not a free-standing tx)?
 *   Prisma's $transaction is callback-only — the tx object is destroyed when
 *   the callback returns. The plan §5-T05 line "returns a Prisma.TransactionClient"
 *   is shorthand; the only correct shape is the callback form below.
 *
 * Why set_config (not SET LOCAL)?
 *   Postgres SET LOCAL does not accept parameterized values — the right-hand
 *   side must be a literal. set_config('var', $1, true) does accept a
 *   parameterized value and is equivalent to SET LOCAL. Avoids needing
 *   $executeRawUnsafe with string concatenation.
 *
 * forSystem() returns the raw client for non-tenant-scoped paths (health
 * checks, migration runners, cross-tenant admin queries). It must NOT be
 * used by request-handling or job-processing code paths.
 */

declare global {
  // Prevent multiple instances in development hot-reload
  // eslint-disable-next-line no-var
  var __sepRuntimePrismaClient: PrismaClient | undefined;
}

function getRuntimeDatabaseUrl(): string | undefined {
  // eslint-disable-next-line no-process-env -- single entry point for runtime DB URL
  return process.env['RUNTIME_DATABASE_URL'] ?? undefined;
}

function createRuntimeClient(): PrismaClient {
  const datasourceUrl = getRuntimeDatabaseUrl();

  return new PrismaClient({
    log: [
      { level: 'warn', emit: 'event' },
      { level: 'error', emit: 'event' },
    ],
    errorFormat: 'minimal',
    ...(datasourceUrl !== undefined && {
      datasourceUrl,
    }),
  });
}

function getRuntimeClient(): PrismaClient {
  if (global.__sepRuntimePrismaClient === undefined) {
    global.__sepRuntimePrismaClient = createRuntimeClient();
  }
  return global.__sepRuntimePrismaClient;
}

export class DatabaseService {
  private readonly client: PrismaClient;

  constructor(client?: PrismaClient) {
    this.client = client ?? getRuntimeClient();
  }

  /**
   * Run `fn` inside a Prisma transaction with `app.current_tenant_id` set
   * to `tenantId`. RLS policies on tenant-scoped tables fail-closed when
   * the variable is unset; here it is set per the validated cuid.
   *
   * Throws TENANT_CONTEXT_MISSING when tenantId is null/undefined/empty.
   * Throws TENANT_CONTEXT_INVALID when tenantId does not match the cuid
   * shape required by Tenant.id (Prisma `@default(cuid())`).
   *
   * Both errors are programming bugs (terminal, never retryable).
   */
  forTenant<T>(tenantId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    if (typeof tenantId !== 'string' || tenantId.length === 0) {
      throw new SepError(ErrorCode.TENANT_CONTEXT_MISSING);
    }
    if (!CuidSchema.safeParse(tenantId).success) {
      throw new SepError(ErrorCode.TENANT_CONTEXT_INVALID, { tenantId });
    }

    return this.client.$transaction(async (tx) => {
      // set_config(name, value, is_local=true) is the parameterized
      // equivalent of `SET LOCAL` — the SET statement itself does not
      // accept parameters. is_local=true scopes the change to this
      // transaction.
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      return fn(tx);
    });
  }

  /**
   * Returns the raw Prisma client for system-level operations that are not
   * tenant-scoped: health checks, migrations, cross-tenant admin queries.
   *
   * Request-handling and job-processing code MUST NOT call this — use
   * forTenant() so RLS context is established.
   */
  forSystem(): PrismaClient {
    return this.client;
  }

  /**
   * System-scope transactional wrapper for flows that combine a
   * platform-scope write with a tenant-scoped audit append in one atomic
   * unit (e.g., tenant.create / tenant.update / tenant.suspend).
   *
   * Two modes:
   *
   * 1. `tenantIdForAudit` provided (id known up front — update/suspend):
   *    forSystemTx sets `app.current_tenant_id` BEFORE invoking the
   *    callback, so any audit.record(tx, ...) inside the callback inherits
   *    the RLS context. Validation of the cuid shape happens up front,
   *    before the tx opens.
   *
   * 2. `tenantIdForAudit` null (id not yet known — tenant.create):
   *    forSystemTx opens the tx without setting RLS context. The caller
   *    is expected to set context manually after the platform write that
   *    materialises the tenant id:
   *
   *        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenant.id}, true)`;
   *        await this.audit.record(tx, {...});
   *
   *    The two-statement pattern keeps the contract explicit: a fresh
   *    tenant id only becomes available inside the tx, and forSystemTx
   *    cannot guess when the platform write completes.
   *
   * If a caller passes null AND tries to write an audit event without
   * manually setting the context, the audit_events `tenant_insert` WITH
   * CHECK will fail the insert — the correct signal that the flow has
   * bypassed RLS context.
   *
   * Distinct from forTenant(): forTenant requires the tenant id up front
   * and is the right choice for any flow where the id pre-exists.
   * forSystemTx is the narrow escape hatch for platform-bootstrap flows.
   */
  forSystemTx<T>(
    tenantIdForAudit: string | null,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (tenantIdForAudit !== null) {
      if (typeof tenantIdForAudit !== 'string' || tenantIdForAudit.length === 0) {
        throw new SepError(ErrorCode.TENANT_CONTEXT_MISSING);
      }
      if (!CuidSchema.safeParse(tenantIdForAudit).success) {
        throw new SepError(ErrorCode.TENANT_CONTEXT_INVALID, { tenantId: tenantIdForAudit });
      }
    }

    return this.client.$transaction(async (tx) => {
      if (tenantIdForAudit !== null) {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantIdForAudit}, true)`;
      }
      return fn(tx);
    });
  }

  /**
   * Disconnect the runtime client. Used in graceful shutdown.
   */
  async disconnect(): Promise<void> {
    await this.client.$disconnect();
    if (global.__sepRuntimePrismaClient === this.client) {
      global.__sepRuntimePrismaClient = undefined;
    }
  }
}

/** Singleton for non-NestJS contexts (packages, tests) */
let _defaultInstance: DatabaseService | undefined;

export function getDatabaseService(): DatabaseService {
  if (_defaultInstance === undefined) {
    _defaultInstance = new DatabaseService();
  }
  return _defaultInstance;
}

/** Reset for testing only */
export function _resetDatabaseServiceForTest(): void {
  _defaultInstance = undefined;
  if (global.__sepRuntimePrismaClient !== undefined) {
    void global.__sepRuntimePrismaClient.$disconnect();
    global.__sepRuntimePrismaClient = undefined;
  }
}
