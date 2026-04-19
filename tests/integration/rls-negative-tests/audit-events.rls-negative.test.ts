// M3.A1-T06: RLS negative assertions for `audit_events` (handwritten).
//
// audit_events diverges from the helper's standard 8-assertion pattern in
// two ways and is therefore handwritten rather than parametrized:
//
// (1) Writes (INSERT/UPDATE/DELETE) are blocked at the GRANT layer by the
//     REVOKE landed in PR #23 (M3.A1-T04 migration
//     20260418222953_enable_rls_tenant_tables — bottom of the file). The
//     REVOKE strips UPDATE/DELETE/INSERT from sep_app, so all 6 write
//     attempts in the standard pattern raise "permission denied for table
//     audit_events" rather than failing via RLS predicate. The error class
//     is correct (writes are prevented from the runtime role) but the
//     mechanism differs from the other 17 tables — a class change worth
//     making explicit instead of hiding behind a helper discriminator.
//
// (2) SELECT is NOT blocked by REVOKE (sep_app retains SELECT) and the
//     baseline `audit_allow_select` policy USING (true) OR-wins against
//     the M3.A1-T04 `audit_events_tenant_select` policy. Cross-tenant
//     SELECT is currently visible — same RLS gap PR #23 round-3 re-read
//     surfaced. Two assertions in this file therefore document the
//     CURRENT permissive behavior rather than the desired tenant-isolated
//     behavior. They will flip to .toBe(0) in M3.A2 when audit_allow_select
//     is dropped (and AuditService writes via parent transaction
//     re-acquire INSERT via a controlled GRANT).
//
// TODO(M3.A2): when audit_allow_select is dropped and tenant_select
// becomes the only SELECT policy on audit_events, flip these two
// assertions from .toBeGreaterThan(0) to .toBe(0). See PR #23 round-3
// re-read finding and issue #26.

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ensureTestTenants,
  hasIntegrationEnv,
  makeDb,
  makeRuntimeClient,
  makeSeedClient,
  TENANT_A_ID,
  TENANT_B_ID,
} from './_helpers/clients';
import { DatabaseService } from '@sep/db';

describe.skipIf(!hasIntegrationEnv)('RLS negative — audit_events', () => {
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

    // Seed via sep (BYPASSRLS) — sep_app's grant-layer REVOKE prevents
    // it from doing this directly. The seeded rows feed the SELECT-
    // divergence assertions and the targeted-row write assertions.
    const seededA = await seedClient.auditEvent.create({
      data: {
        tenantId: TENANT_A_ID,
        actorType: 'SYSTEM',
        actorId: 'rls-negative-test',
        objectType: 'TestObject',
        objectId: 'seed-a',
        action: 'TENANT_CREATED',
        result: 'SUCCESS',
        immutableHash: `audit-seed-a-${Date.now()}`,
      },
    });
    const seededB = await seedClient.auditEvent.create({
      data: {
        tenantId: TENANT_B_ID,
        actorType: 'SYSTEM',
        actorId: 'rls-negative-test',
        objectType: 'TestObject',
        objectId: 'seed-b',
        action: 'TENANT_CREATED',
        result: 'SUCCESS',
        immutableHash: `audit-seed-b-${Date.now()}`,
      },
    });
    seededARowId = seededA.id;
    seededBRowId = seededB.id;
  });

  afterAll(async () => {
    // No cleanup of audit_events — the M3.0 audit_deny_delete policy
    // (USING false) blocks DELETE for every role, BYPASSRLS or not. Rows
    // accumulate across local reruns; CI starts from a fresh DB, so this
    // is dev-only. Unlike crypto_operation_records, the deny here is via
    // RLS policy rather than a trigger, but the practical effect is the
    // same: the seed row is permanent.
    await seedClient.$disconnect();
    await runtimeClient.$disconnect();
  });

  // ── Without tenant context ──────────────────────────────────────────────

  it('audit_events: SELECT without tenant context returns rows (DIVERGENT)', async () => {
    // TODO(M3.A2): when audit_allow_select is dropped and tenant_select
    // becomes the only SELECT policy on audit_events, flip this from
    // .toBeGreaterThan(0) to .toBe(0). See PR #23 round-3 re-read finding
    // and issue #26.
    const rows = await runtimeClient.auditEvent.findMany();
    expect(rows.length).toBeGreaterThan(0);
  });

  it('audit_events: INSERT without tenant context fails (grant-layer REVOKE)', async () => {
    // sep_app has no INSERT grant on audit_events after PR #23's REVOKE.
    // This raises "permission denied for table audit_events" — different
    // class from the WITH CHECK rejection on the other 17 tables but a
    // stronger guarantee (RLS-bypassable roles cannot circumvent it
    // without re-granting at the role level).
    await expect(
      runtimeClient.auditEvent.create({
        data: {
          tenantId: TENANT_A_ID,
          actorType: 'SYSTEM',
          actorId: 'probe',
          objectType: 'Probe',
          objectId: 'probe',
          action: 'TENANT_CREATED',
          result: 'SUCCESS',
          immutableHash: `probe-${Date.now()}`,
        },
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it('audit_events: UPDATE without tenant context fails (grant-layer REVOKE)', async () => {
    await expect(
      runtimeClient.auditEvent.updateMany({
        where: { id: seededARowId },
        data: { result: 'updated-by-rls-negative' },
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it('audit_events: DELETE without tenant context fails (grant-layer REVOKE)', async () => {
    await expect(
      runtimeClient.auditEvent.deleteMany({ where: { id: seededARowId } }),
    ).rejects.toThrow(/permission denied/i);
  });

  // ── With tenant-A context, targeting tenant-B rows ──────────────────────

  it('audit_events: SELECT in tenant-A context still sees tenant-B rows (DIVERGENT)', async () => {
    // TODO(M3.A2): when audit_allow_select is dropped and tenant_select
    // becomes the only SELECT policy on audit_events, flip this from
    // .toBeGreaterThan(0) to .toBe(0). See PR #23 round-3 re-read finding
    // and issue #26.
    const rows = await db.forTenant(TENANT_A_ID, async (tx) =>
      tx.auditEvent.findMany({ where: { id: seededBRowId } }),
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('audit_events: INSERT in tenant-A context with tenantId=B fails (grant-layer REVOKE)', async () => {
    await expect(
      db.forTenant(TENANT_A_ID, async (tx) =>
        tx.auditEvent.create({
          data: {
            tenantId: TENANT_B_ID,
            actorType: 'SYSTEM',
            actorId: 'probe',
            objectType: 'Probe',
            objectId: 'probe',
            action: 'TENANT_CREATED',
            result: 'SUCCESS',
            immutableHash: `probe-${Date.now()}`,
          },
        }),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('audit_events: UPDATE in tenant-A context on tenant-B row fails (grant-layer REVOKE)', async () => {
    await expect(
      db.forTenant(TENANT_A_ID, async (tx) =>
        tx.auditEvent.updateMany({
          where: { id: seededBRowId },
          data: { result: 'updated-by-rls-negative' },
        }),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('audit_events: DELETE in tenant-A context on tenant-B row fails (grant-layer REVOKE)', async () => {
    await expect(
      db.forTenant(TENANT_A_ID, async (tx) =>
        tx.auditEvent.deleteMany({ where: { id: seededBRowId } }),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});
