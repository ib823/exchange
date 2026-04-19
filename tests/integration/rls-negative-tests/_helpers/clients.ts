// Shared test-fixture infrastructure for the M3.A1-T06 negative suite.
//
// Two PrismaClient instances per test file:
//   - seedClient connects as the migration role (sep) which has BYPASSRLS.
//     Used to set up cross-tenant data the runtime must NOT be able to see.
//   - runtimeClient connects as the application role (sep_app) which has
//     BYPASSRLS=false and is the role every RLS policy applies to. This is
//     the role under test.
//
// The DatabaseService wraps runtimeClient and exposes forTenant() — that is
// the path runtime callers use, so it is what we exercise.
//
// Tenants are upserted (idempotent) by ensureTestTenants() and deliberately
// NOT torn down. Per-table cleanup removes only the rows each table seeded.

import { PrismaClient } from '@prisma/client';
import { DatabaseService } from '@sep/db';

// eslint-disable-next-line no-process-env -- integration gate reads env directly
export const MIGRATION_URL: string | undefined = process.env['DATABASE_URL'];
// eslint-disable-next-line no-process-env -- integration gate reads env directly
export const RUNTIME_URL: string | undefined = process.env['RUNTIME_DATABASE_URL'];

export const hasIntegrationEnv: boolean =
  MIGRATION_URL !== undefined &&
  MIGRATION_URL.length > 0 &&
  RUNTIME_URL !== undefined &&
  RUNTIME_URL.length > 0;

// Fixed cuids matching the schema validator (leading 'c' + lowercase
// alphanumerics). Two distinct tenants whose isolation is the property
// under test.
export const TENANT_A_ID = 'cnegativetenanta1234567890';
export const TENANT_B_ID = 'cnegativetenantb1234567890';

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

/**
 * Idempotent tenant setup. Safe to call from multiple test files in
 * parallel — upsert collapses duplicate creates. Deliberately does NOT
 * tear down: tenants persist across the suite so concurrent files do not
 * race on each other's teardown.
 */
export async function ensureTestTenants(seedClient: PrismaClient): Promise<void> {
  await seedClient.tenant.upsert({
    where: { id: TENANT_A_ID },
    update: {},
    create: { id: TENANT_A_ID, name: 'RLS-Neg Tenant A', legalEntityName: 'RLS-Neg Tenant A LLC' },
  });
  await seedClient.tenant.upsert({
    where: { id: TENANT_B_ID },
    update: {},
    create: { id: TENANT_B_ID, name: 'RLS-Neg Tenant B', legalEntityName: 'RLS-Neg Tenant B LLC' },
  });
}
