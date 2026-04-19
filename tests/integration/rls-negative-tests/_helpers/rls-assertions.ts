// Per-table 8-assertion factory for the M3.A1-T06 negative suite.
//
// Plan §5-T06 requires 18 tables × 8 assertions = 144 total cross-tenant
// negative assertions. Hand-writing 144 near-duplicate test bodies would
// invite drift, so the 17 standard tenant-scoped tables go through this
// helper. (audit_events diverges by design — see audit_events.rls-negative
// .test.ts for that file's handwritten 8 assertions and the M3.A2 TODOs.)
//
// The 8 assertions, paired with the cross-tenant property each proves:
//
//   Without tenant context (runtime client used directly, no forTenant):
//     1. SELECT returns 0 rows         — RLS USING fails-closed without GUC
//     2. INSERT fails                  — WITH CHECK rejects (NULLIF → NULL)
//     3. UPDATE affects 0 rows         — USING hides every row from update
//     4. DELETE affects 0 rows         — USING hides every row from delete
//
//   With tenant-A context, looking at tenant-B rows:
//     5. SELECT returns 0 tenant-B rows — USING limits visibility to A
//     6. INSERT with tenantId=B fails   — WITH CHECK rejects cross-tenant
//                                          insert (covers gotcha #7 — UPDATE
//                                          variant covered in #7 below)
//     7. UPDATE on tenant-B row 0 rows  — USING + WITH CHECK both protect
//     8. DELETE on tenant-B row 0 rows  — USING protects
//
// The runtime role is sep_app (BYPASSRLS=false). The seed role is sep
// (BYPASSRLS=true) so cross-tenant data exists for assertions 5/7/8 to
// have something to NOT see.

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DatabaseService } from '@sep/db';

import {
  ensureTestTenants,
  hasIntegrationEnv,
  makeDb,
  makeRuntimeClient,
  makeSeedClient,
  TENANT_A_ID,
  TENANT_B_ID,
} from './clients';

export interface RlsAssertionConfig {
  /** Display label and SQL identifier (e.g., 'users'). */
  tableName: string;
  /**
   * Prisma client model accessor key (e.g., 'user', 'roleAssignment').
   * Indexed dynamically inside the helper; the per-table file owns
   * type-correctness via the seed/payload callbacks below.
   */
  modelKey: string;
  /**
   * Optional setup for parent rows (partner_profile, submission, etc.)
   * required by FKs on the table under test. Runs once per file before
   * seedRow. Use seedClient (BYPASSRLS) so parent rows are unaffected
   * by RLS during setup.
   */
  setupParents?: (seedClient: PrismaClient) => Promise<void>;
  /**
   * Create one row in the given tenant. Returns the seeded row's id so
   * cross-tenant assertions (5/7/8) can target it by primary key. The
   * seed runs twice — once for tenant A, once for tenant B.
   */
  seedRow: (seedClient: PrismaClient, tenantId: string) => Promise<{ id: string }>;
  /**
   * A valid INSERT payload for the given tenant — must satisfy NOT NULL,
   * unique, and FK constraints other than the RLS predicate. Used by
   * assertions 2 and 6.
   */
  validInsertPayload: (tenantId: string) => Record<string, unknown>;
  /**
   * Partial UPDATE payload that touches at least one non-tenant column.
   * Used by assertions 3 and 7. MUST NOT modify tenantId (that would
   * confound the test by exercising a different leakage class).
   */
  validUpdatePayload: () => Record<string, unknown>;
  /**
   * Per-file row teardown. Removes seeded rows + parent rows. Tenants
   * are NOT cleaned up here — see clients.ts for why.
   */
  cleanup: (seedClient: PrismaClient) => Promise<void>;
}

type ModelDelegate = {
  create: (args: { data: unknown }) => Promise<{ id: string } & Record<string, unknown>>;
  findMany: (args?: { where?: unknown }) => Promise<Array<Record<string, unknown>>>;
  updateMany: (args: { where: unknown; data: unknown }) => Promise<{ count: number }>;
  deleteMany: (args: { where: unknown }) => Promise<{ count: number }>;
};

function model(client: PrismaClient | { [k: string]: unknown }, key: string): ModelDelegate {
  const delegate = (client as unknown as Record<string, unknown>)[key];
  if (delegate === undefined || delegate === null) {
    throw new Error(
      `PrismaClient has no model accessor '${key}' — check modelKey in helper config`,
    );
  }
  return delegate as ModelDelegate;
}

export function assertsRlsOnTable(config: RlsAssertionConfig): void {
  describe.skipIf(!hasIntegrationEnv)(`RLS negative — ${config.tableName}`, () => {
    let seedClient: PrismaClient;
    let runtimeClient: PrismaClient;
    let db: DatabaseService;
    let seededARowId: string;
    let seededBRowId: string;

    beforeAll(async () => {
      seedClient = makeSeedClient();
      runtimeClient = makeRuntimeClient();
      db = makeDb(runtimeClient);

      await ensureTestTenants(seedClient);
      if (config.setupParents !== undefined) {
        await config.setupParents(seedClient);
      }

      const seededA = await config.seedRow(seedClient, TENANT_A_ID);
      const seededB = await config.seedRow(seedClient, TENANT_B_ID);
      seededARowId = seededA.id;
      seededBRowId = seededB.id;
    });

    afterAll(async () => {
      await config.cleanup(seedClient);
      await seedClient.$disconnect();
      await runtimeClient.$disconnect();
    });

    // ── Without tenant context ────────────────────────────────────────────

    it(`${config.tableName}: SELECT without tenant context returns 0 rows`, async () => {
      const rows = await model(runtimeClient, config.modelKey).findMany();
      expect(rows.length).toBe(0);
    });

    it(`${config.tableName}: INSERT without tenant context fails`, async () => {
      // Runtime client outside any forTenant() — the GUC is unset, NULLIF
      // returns NULL, WITH CHECK predicate evaluates NULL → row rejected.
      // Postgres throws; Prisma surfaces a known-error wrapping it.
      await expect(
        model(runtimeClient, config.modelKey).create({
          data: config.validInsertPayload(TENANT_A_ID),
        }),
      ).rejects.toThrow();
    });

    it(`${config.tableName}: UPDATE without tenant context affects 0 rows`, async () => {
      // updateMany returns count of affected rows. Without GUC, USING
      // hides every row from the runtime — count must be 0 even though
      // the seeded row exists in the table (sep can see it).
      const result = await model(runtimeClient, config.modelKey).updateMany({
        where: { id: seededARowId },
        data: config.validUpdatePayload(),
      });
      expect(result.count).toBe(0);
    });

    it(`${config.tableName}: DELETE without tenant context affects 0 rows`, async () => {
      const result = await model(runtimeClient, config.modelKey).deleteMany({
        where: { id: seededARowId },
      });
      expect(result.count).toBe(0);
    });

    // ── With tenant-A context, targeting tenant-B rows ────────────────────

    it(`${config.tableName}: SELECT in tenant-A context does not see tenant-B rows`, async () => {
      const rows = await db.forTenant(TENANT_A_ID, async (tx) =>
        model(tx, config.modelKey).findMany({ where: { id: seededBRowId } }),
      );
      expect(rows.length).toBe(0);
    });

    it(`${config.tableName}: INSERT in tenant-A context with tenantId=B fails WITH CHECK`, async () => {
      // GUC = TENANT_A_ID, payload tenantId = TENANT_B_ID. WITH CHECK
      // predicate evaluates `'cnegativetenantb...' = 'cnegativetenanta...'`
      // → false → row rejected.
      await expect(
        db.forTenant(TENANT_A_ID, async (tx) =>
          model(tx, config.modelKey).create({
            data: config.validInsertPayload(TENANT_B_ID),
          }),
        ),
      ).rejects.toThrow();
    });

    it(`${config.tableName}: UPDATE in tenant-A context on tenant-B row affects 0 rows`, async () => {
      const result = await db.forTenant(TENANT_A_ID, async (tx) =>
        model(tx, config.modelKey).updateMany({
          where: { id: seededBRowId },
          data: config.validUpdatePayload(),
        }),
      );
      expect(result.count).toBe(0);
    });

    it(`${config.tableName}: DELETE in tenant-A context on tenant-B row affects 0 rows`, async () => {
      const result = await db.forTenant(TENANT_A_ID, async (tx) =>
        model(tx, config.modelKey).deleteMany({ where: { id: seededBRowId } }),
      );
      expect(result.count).toBe(0);
    });
  });
}
