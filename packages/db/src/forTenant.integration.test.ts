import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ErrorCode, isSepError } from '@sep/common';
import { DatabaseService } from './database.service';

// eslint-disable-next-line no-process-env -- integration gate reads env directly
const MIGRATION_URL = process.env['DATABASE_URL'];
// eslint-disable-next-line no-process-env -- integration gate reads env directly
const RUNTIME_URL = process.env['RUNTIME_DATABASE_URL'];

const hasIntegrationEnv =
  MIGRATION_URL !== undefined &&
  MIGRATION_URL.length > 0 &&
  RUNTIME_URL !== undefined &&
  RUNTIME_URL.length > 0;

// Use cuids that match the schema validator. The shape is the project's
// "real" cuid format: leading 'c' + lowercase alphanumerics. Two distinct
// tenants are seeded; isolation between them is the core property under test.
const TENANT_A_ID = 'cforatenanta1234567890abc';
const TENANT_B_ID = 'cforbtenantb1234567890abc';

describe.skipIf(!hasIntegrationEnv)('DatabaseService.forTenant() — integration', () => {
  // Migration client (sep — has BYPASSRLS) for seeding cross-tenant data.
  // The DatabaseService under test wraps the runtime client (sep_app — RLS-
  // bound), which is what real callers use.
  const seedClient = new PrismaClient({
    ...(MIGRATION_URL !== undefined && { datasourceUrl: MIGRATION_URL }),
  });
  const runtimeClient = new PrismaClient({
    ...(RUNTIME_URL !== undefined && { datasourceUrl: RUNTIME_URL }),
  });
  const db = new DatabaseService(runtimeClient);

  beforeAll(async () => {
    // Seed two tenants with one user each. Tenants table has no RLS (it is
    // not tenant-scoped); users table has the M3.A1-T04 tenant policies.
    await seedClient.tenant.upsert({
      where: { id: TENANT_A_ID },
      update: {},
      create: { id: TENANT_A_ID, name: 'Tenant A', legalEntityName: 'Tenant A LLC' },
    });
    await seedClient.tenant.upsert({
      where: { id: TENANT_B_ID },
      update: {},
      create: { id: TENANT_B_ID, name: 'Tenant B', legalEntityName: 'Tenant B LLC' },
    });
    await seedClient.user.upsert({
      where: { tenantId_email: { tenantId: TENANT_A_ID, email: 'alice@a.test' } },
      update: {},
      create: { tenantId: TENANT_A_ID, email: 'alice@a.test', displayName: 'Alice (A)' },
    });
    await seedClient.user.upsert({
      where: { tenantId_email: { tenantId: TENANT_B_ID, email: 'bob@b.test' } },
      update: {},
      create: { tenantId: TENANT_B_ID, email: 'bob@b.test', displayName: 'Bob (B)' },
    });
  });

  afterAll(async () => {
    // Clean up — sep can DELETE because RLS doesn't apply to BYPASSRLS roles
    // and users table has no append-only trigger.
    await seedClient.user.deleteMany({
      where: { tenantId: { in: [TENANT_A_ID, TENANT_B_ID] } },
    });
    await seedClient.tenant.deleteMany({
      where: { id: { in: [TENANT_A_ID, TENANT_B_ID] } },
    });
    await seedClient.$disconnect();
    await runtimeClient.$disconnect();
  });

  // ── Cross-tenant isolation ────────────────────────────────────────────────

  it('queries inside a tenant-A context return only tenant-A rows', async () => {
    const usersA = await db.forTenant(TENANT_A_ID, async (tx) => tx.user.findMany());
    expect(usersA.map((u) => u.email)).toEqual(['alice@a.test']);

    const usersB = await db.forTenant(TENANT_B_ID, async (tx) => tx.user.findMany());
    expect(usersB.map((u) => u.email)).toEqual(['bob@b.test']);
  });

  it('insert with tenant context = tenant-A is visible to tenant A but not tenant B', async () => {
    const probeEmail = `probe-${Date.now()}@a.test`;

    await db.forTenant(TENANT_A_ID, async (tx) =>
      tx.user.create({
        data: { tenantId: TENANT_A_ID, email: probeEmail, displayName: 'Probe' },
      }),
    );

    const visibleToA = await db.forTenant(TENANT_A_ID, async (tx) =>
      tx.user.findFirst({ where: { email: probeEmail } }),
    );
    expect(visibleToA?.email).toBe(probeEmail);

    const visibleToB = await db.forTenant(TENANT_B_ID, async (tx) =>
      tx.user.findFirst({ where: { email: probeEmail } }),
    );
    expect(visibleToB).toBeNull();

    // Cleanup
    await seedClient.user.deleteMany({ where: { email: probeEmail } });
  });

  // ── Validation errors ─────────────────────────────────────────────────────

  it('throws TENANT_CONTEXT_MISSING when tenantId is empty', async () => {
    try {
      await db.forTenant('', () => Promise.resolve(undefined));
      throw new Error('expected forTenant to throw');
    } catch (err) {
      expect(isSepError(err)).toBe(true);
      if (isSepError(err)) {
        expect(err.code).toBe(ErrorCode.TENANT_CONTEXT_MISSING);
      }
    }
  });

  it('throws TENANT_CONTEXT_INVALID when tenantId is a UUID, not a cuid', async () => {
    try {
      await db.forTenant('550e8400-e29b-41d4-a716-446655440000', () => Promise.resolve(undefined));
      throw new Error('expected forTenant to throw');
    } catch (err) {
      expect(isSepError(err)).toBe(true);
      if (isSepError(err)) {
        expect(err.code).toBe(ErrorCode.TENANT_CONTEXT_INVALID);
      }
    }
  });

  it('does not enter the $transaction when validation fails', async () => {
    let entered = false;
    try {
      await db.forTenant('', () => {
        entered = true;
        return Promise.resolve(undefined);
      });
    } catch {
      // expected
    }
    expect(entered).toBe(false);
  });

  // ── set_config / pool connection scope ────────────────────────────────────
  // gotcha #5 from the execution prompt: verify Prisma issues the
  // set_config and subsequent queries on the same pool connection. If they
  // landed on different connections, the SET LOCAL would not affect the
  // SELECT and RLS would silently return zero rows instead of the expected
  // tenant-scoped rows.

  it('set_config and subsequent queries share the same transaction connection', async () => {
    const result = await db.forTenant(TENANT_A_ID, async (tx) => {
      const before = await tx.$queryRaw<Array<{ current_setting: string }>>`
        SELECT current_setting('app.current_tenant_id', true) AS current_setting
      `;
      const userCount = await tx.user.count();
      const after = await tx.$queryRaw<Array<{ current_setting: string }>>`
        SELECT current_setting('app.current_tenant_id', true) AS current_setting
      `;
      return {
        before: before[0]?.current_setting,
        userCount,
        after: after[0]?.current_setting,
      };
    });

    // Both reads must see the tenant context that was set by forTenant.
    expect(result.before).toBe(TENANT_A_ID);
    expect(result.after).toBe(TENANT_A_ID);
    // And the count reflected RLS scoping (only tenant-A users visible).
    expect(result.userCount).toBeGreaterThanOrEqual(1);
  });

  it('different forTenant calls use independent transaction-local contexts', async () => {
    // After a tenant-A transaction commits, a fresh transaction without
    // tenant context (would throw TENANT_CONTEXT_MISSING — proxy via running
    // a tenant-B forTenant and confirming the GUC is tenant-B, not tenant-A).
    await db.forTenant(TENANT_A_ID, async (tx) => {
      const seen = await tx.$queryRaw<Array<{ current_setting: string }>>`
        SELECT current_setting('app.current_tenant_id', true) AS current_setting
      `;
      expect(seen[0]?.current_setting).toBe(TENANT_A_ID);
    });

    await db.forTenant(TENANT_B_ID, async (tx) => {
      const seen = await tx.$queryRaw<Array<{ current_setting: string }>>`
        SELECT current_setting('app.current_tenant_id', true) AS current_setting
      `;
      expect(seen[0]?.current_setting).toBe(TENANT_B_ID);
    });
  });
});
