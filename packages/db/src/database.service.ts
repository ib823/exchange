import { PrismaClient } from '@prisma/client';

/**
 * Tenant-scoped database accessor.
 *
 * Every database interaction from the application must go through this service.
 * It wraps the Prisma client and enforces that tenant context is always provided.
 *
 * Design decisions:
 * - tenantId is an explicit parameter on every method that touches tenant-scoped data
 * - forTenant() returns the raw Prisma client today but establishes the integration
 *   point where M3 RLS can inject SET LOCAL app.current_tenant_id per-connection
 * - Direct getPrismaClient() calls in service code are eliminated by design
 * - Health checks and migrations use the raw client via forSystem() — no tenant context
 *
 * M3 integration path:
 *   forTenant() will wrap the operation in $transaction and call
 *   SET LOCAL app.current_tenant_id = $1 before returning the transactional client.
 *   This is the ONLY place that change needs to happen.
 */

declare global {
  // Prevent multiple instances in development hot-reload
  // eslint-disable-next-line no-var
  var __sepRuntimePrismaClient: PrismaClient | undefined;
}

/**
 * Determines the correct DATABASE_URL for the runtime application.
 * RUNTIME_DATABASE_URL (sep_app role) takes precedence over DATABASE_URL (migration role).
 */
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
   * Returns a Prisma client scoped to a tenant context.
   *
   * Today this returns the raw client. In M3, this will wrap operations
   * in a transaction that sets `app.current_tenant_id` via SET LOCAL,
   * enabling PostgreSQL RLS to enforce tenant isolation at the database level.
   *
   * @param tenantId — required. Throws if missing or empty.
   */
  forTenant(tenantId: string): PrismaClient {
    if (tenantId.length === 0) {
      throw new Error(
        'DatabaseService.forTenant() requires a non-empty tenantId. ' +
        'This is a programming error — tenant context must always be provided.',
      );
    }

    // M3 RLS integration point:
    // return this.client.$transaction(async (tx) => {
    //   await tx.$executeRaw`SET LOCAL app.current_tenant_id = ${tenantId}`;
    //   return tx;
    // });

    return this.client;
  }

  /**
   * Returns the raw Prisma client for system-level operations that are not
   * tenant-scoped: health checks, migrations, cross-tenant admin queries.
   *
   * M2+ processors must NOT use this for tenant-scoped data access.
   */
  forSystem(): PrismaClient {
    return this.client;
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
