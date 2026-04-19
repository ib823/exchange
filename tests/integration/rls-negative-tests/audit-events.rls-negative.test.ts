// M3.A1-T06: RLS negative assertions for `audit_events` (handwritten).
//
// audit_events diverges from the helper's standard 8-assertion pattern in
// two ways and is therefore handwritten rather than parametrized:
//
// (1) UPDATE/DELETE writes are blocked at the GRANT layer by REVOKEs that
//     have been in place since 20260418222953 (M3.A1-T04) and remain after
//     M3.A2-T03 — sep_app has no UPDATE or DELETE grant on audit_events.
//     All UPDATE/DELETE attempts raise "permission denied for table
//     audit_events" rather than failing via RLS predicate or trigger.
//     A second layer (the BEFORE UPDATE / BEFORE DELETE triggers
//     audit_events_no_update / audit_events_no_delete added by
//     20260412140000) sits behind the grant layer for defense-in-depth.
//
// (2) INSERT writes are GRANTED to sep_app (restored by M3.A2-T03 so
//     AuditService.record can write inside forTenant). The
//     audit_events_tenant_insert WITH CHECK policy enforces tenant
//     boundary — INSERT attempts without the right app.current_tenant_id
//     raise "new row violates row-level security policy" rather than
//     "permission denied".
//
// (3) SELECT is correctly tenant-scoped after M3.A2-T03 dropped the
//     baseline audit_allow_select USING (true) policy. Cross-tenant
//     SELECT now returns zero rows. Issue #26 is closed.

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

    // Seed via sep (BYPASSRLS). sep_app's INSERT grant is enforced via
    // tenant_insert WITH CHECK, so seed via sep keeps the seeded rows
    // independent of any app-level policy state under test.
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
    // No cleanup of audit_events. The BEFORE DELETE trigger
    // (audit_events_no_delete from 20260412140000) RAISEs on every
    // delete attempt regardless of role — both sep and sep_app are
    // blocked. Rows accumulate across local reruns; CI starts from a
    // fresh DB.
    await seedClient.$disconnect();
    await runtimeClient.$disconnect();
  });

  // ── Without tenant context ──────────────────────────────────────────────

  it('audit_events: SELECT without tenant context returns zero rows (tenant-scoped)', async () => {
    // Post M3.A2-T03: audit_allow_select USING (true) is gone, so
    // tenant_select USING tenantId = current_tenant_id is the only SELECT
    // policy. With no app.current_tenant_id set, NULLIF returns NULL and
    // no rows match. Closes issue #26.
    const rows = await runtimeClient.auditEvent.findMany();
    expect(rows.length).toBe(0);
  });

  it('audit_events: INSERT without tenant context fails (tenant_insert WITH CHECK)', async () => {
    // sep_app has INSERT grant restored by M3.A2-T03; the audit_events
    // tenant_insert WITH CHECK rejects rows whose tenantId does not
    // match app.current_tenant_id. With no context set, the check fails.
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
    ).rejects.toThrow(/row-level security/i);
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

  it('audit_events: SELECT in tenant-A context cannot see tenant-B rows', async () => {
    // tenant_select correctly scopes after M3.A2-T03 drop of audit_allow_select.
    const rows = await db.forTenant(TENANT_A_ID, async (tx) =>
      tx.auditEvent.findMany({ where: { id: seededBRowId } }),
    );
    expect(rows.length).toBe(0);
  });

  it('audit_events: INSERT in tenant-A context with tenantId=B fails (tenant_insert WITH CHECK)', async () => {
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
    ).rejects.toThrow(/row-level security/i);
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

  // ── M3.A2 positive assertions: INSERT with correct tenant context succeeds ──

  it('audit_events: INSERT in tenant-A context with tenantId=A succeeds (M3.A2 happy path)', async () => {
    // Validates the closed regression: AuditService.record writes via
    // sep_app inside forTenant now succeed. Before M3.A2 this raised
    // "permission denied" because PR #23 had revoked INSERT.
    const created = await db.forTenant(TENANT_A_ID, async (tx) =>
      tx.auditEvent.create({
        data: {
          tenantId: TENANT_A_ID,
          actorType: 'SYSTEM',
          actorId: 'm3a2-positive',
          objectType: 'Probe',
          objectId: `m3a2-${Date.now()}`,
          action: 'TENANT_CREATED',
          result: 'SUCCESS',
          immutableHash: `m3a2-positive-${Date.now()}`,
        },
      }),
    );
    expect(created.id).toBeDefined();
    expect(created.tenantId).toBe(TENANT_A_ID);
  });
});
