/**
 * Shared Postgres client setup for the threat-scenario suite.
 *
 * Mirrors tests/integration/rls-negative-tests/_helpers/clients.ts so
 * the seed/runtime role split is consistent across both suites:
 *
 *   seedClient    — connects as the migration role `sep` (BYPASSRLS).
 *                   Used to create cross-tenant fixtures the runtime
 *                   must NOT be able to see.
 *   runtimeClient — connects as the application role `sep_app`
 *                   (RLS forced). This is the role under test.
 *
 * Tenant IDs are per-scenario (see tenants.ts) so scenarios can run
 * in any order without teardown collisions.
 */

import { PrismaClient } from '@prisma/client';
import { DatabaseService } from '@sep/db';

export const MIGRATION_URL: string | undefined = process.env['DATABASE_URL'];
export const RUNTIME_URL: string | undefined = process.env['RUNTIME_DATABASE_URL'];

export const hasPostgres: boolean =
  typeof MIGRATION_URL === 'string' &&
  MIGRATION_URL.length > 0 &&
  typeof RUNTIME_URL === 'string' &&
  RUNTIME_URL.length > 0;

export function makeSeedClient(): PrismaClient {
  return new PrismaClient({
    ...(MIGRATION_URL !== undefined && { datasourceUrl: MIGRATION_URL }),
  });
}

export function makeRuntimeClient(): PrismaClient {
  return new PrismaClient({
    ...(RUNTIME_URL !== undefined && { datasourceUrl: RUNTIME_URL }),
  });
}

export function makeDb(runtimeClient: PrismaClient): DatabaseService {
  return new DatabaseService(runtimeClient);
}
