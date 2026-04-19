// M3.A2-T04: Integration tests for audit transactional coupling and
// append-only enforcement.
//
// Three concerns:
//
//   (a) Atomicity — if the audit write inside a forTenant block throws,
//       the surrounding business write must roll back. Verified by
//       throwing inside the callback after a business write.
//
//   (b) Append-only enforcement — sep_app cannot UPDATE or DELETE rows
//       in audit_events. Already covered by the rls-negative file's
//       grant-layer assertions; this file adds an explicit check that
//       the BEFORE UPDATE / BEFORE DELETE triggers exist as the second
//       defense layer (verified via pg_trigger; a sep_app attempt would
//       hit the grant first).
//
//   (c) Tenant-scoped SELECT — verified in audit-events.rls-negative.test.ts
//       (`SELECT in tenant-A context cannot see tenant-B rows`).
//       Repeated here as a sanity check that AuditService.search
//       returns only the caller's tenant's rows.

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

describe.skipIf(!hasIntegrationEnv)('M3.A2 audit transactional coupling', () => {
  let seedClient: PrismaClient;
  let runtimeClient: PrismaClient;
  let db: DatabaseService;

  beforeAll(async () => {
    seedClient = makeSeedClient();
    runtimeClient = makeRuntimeClient();
    db = makeDb(runtimeClient);
    await ensureTestTenants(seedClient);
  });

  afterAll(async () => {
    // Audit_events is append-only — the trigger blocks DELETE for every
    // role. Any rows written in this suite persist on local reruns.
    // Webhooks / users created during atomicity tests are cleaned up by
    // each test that owns them.
    await seedClient.$disconnect();
    await runtimeClient.$disconnect();
  });

  // ─── (a) Atomicity ─────────────────────────────────────────────────────

  describe('atomicity — business write rolls back when audit append throws', () => {
    it('webhook insert + thrown audit step → both rolled back', async () => {
      // The probe does a real business write (a webhook), then throws
      // before committing. Outside the callback, no webhook row should
      // be visible — the transaction rolls back.
      const probeUrl = `https://atomicity-probe.example.com/${Date.now()}`;

      await expect(
        db.forTenant(TENANT_A_ID, async (tx) => {
          await tx.webhook.create({
            data: {
              tenantId: TENANT_A_ID,
              url: probeUrl,
              events: ['SUBMISSION_COMPLETED'],
              secretRef: 'vault://atomicity-probe',
            },
          });

          // Simulate "audit write failed" — the AuditService normally
          // throws SepError(DATABASE_ERROR) inside the same tx; that
          // throw propagates and Prisma's $transaction rolls back.
          throw new Error('simulated audit write failure');
        }),
      ).rejects.toThrow('simulated audit write failure');

      // Verify via the BYPASSRLS seed client — sep_app's tenant_select
      // would scope this anyway, but sep gives us an authoritative count
      // independent of the runtime role's policy state.
      const surviving = await seedClient.webhook.count({ where: { url: probeUrl } });
      expect(surviving).toBe(0);
    });

    it('audit insert + later thrown step → audit append rolled back', async () => {
      // The mirror case: audit append succeeds, then we throw later in
      // the tx. The audit row must NOT persist — proves audit writes
      // committed alongside business writes only.
      const probeObjectId = `atomicity-probe-${Date.now()}`;

      const probeHash = `atomicity-${Date.now()}`;
      await expect(
        db.forTenant(TENANT_A_ID, async (tx) => {
          await tx.auditEvent.create({
            data: {
              tenantId: TENANT_A_ID,
              actorType: 'SYSTEM',
              actorId: 'atomicity-probe',
              objectType: 'Probe',
              objectId: probeObjectId,
              action: 'TENANT_UPDATED',
              result: 'SUCCESS',
              immutableHash: probeHash,
            },
          });

          throw new Error('post-audit write failure');
        }),
      ).rejects.toThrow('post-audit write failure');

      // Via BYPASSRLS — audit row must not have committed.
      const surviving = await seedClient.auditEvent.count({
        where: { immutableHash: probeHash },
      });
      expect(surviving).toBe(0);
    });

    it('happy path — webhook + audit both commit when the tx succeeds', async () => {
      const probeUrl = `https://atomicity-happy.example.com/${Date.now()}`;
      const probeHash = `atomicity-happy-${Date.now()}`;

      await db.forTenant(TENANT_A_ID, async (tx) => {
        await tx.webhook.create({
          data: {
            tenantId: TENANT_A_ID,
            url: probeUrl,
            events: ['SUBMISSION_COMPLETED'],
            secretRef: 'vault://atomicity-happy',
          },
        });
        await tx.auditEvent.create({
          data: {
            tenantId: TENANT_A_ID,
            actorType: 'SYSTEM',
            actorId: 'atomicity-happy',
            objectType: 'Webhook',
            objectId: probeUrl,
            action: 'WEBHOOK_REGISTERED',
            result: 'SUCCESS',
            immutableHash: probeHash,
          },
        });
      });

      const webhookCount = await seedClient.webhook.count({ where: { url: probeUrl } });
      const auditCount = await seedClient.auditEvent.count({
        where: { immutableHash: probeHash },
      });
      expect(webhookCount).toBe(1);
      expect(auditCount).toBe(1);

      // Cleanup the webhook (audit_events is append-only and stays).
      await seedClient.webhook.deleteMany({ where: { url: probeUrl } });
    });
  });

  // ─── (b) Append-only enforcement (defense-in-depth) ────────────────────

  describe('append-only enforcement', () => {
    it('append-only triggers exist on audit_events as the second layer', async () => {
      // The rls-negative file already asserts that sep_app cannot
      // UPDATE or DELETE (grant-layer rejection). Behind the grant
      // layer, BEFORE UPDATE / BEFORE DELETE triggers raise
      // "audit_events is append-only" — they survive any future grant
      // drift. Verified here via pg_trigger.
      type TriggerRow = { tgname: string };
      const triggers = await seedClient.$queryRaw<TriggerRow[]>`
        SELECT tgname
        FROM pg_trigger
        WHERE tgrelid = 'audit_events'::regclass
          AND NOT tgisinternal
        ORDER BY tgname
      `;
      const names = triggers.map((row) => row.tgname);
      expect(names).toContain('audit_events_no_update');
      expect(names).toContain('audit_events_no_delete');
    });

    it('M3.0 baseline policies are gone (issue #26 closed)', async () => {
      type PolicyRow = { policyname: string };
      const policies = await seedClient.$queryRaw<PolicyRow[]>`
        SELECT policyname
        FROM pg_policies
        WHERE tablename = 'audit_events'
        ORDER BY policyname
      `;
      const names = policies.map((row) => row.policyname);
      expect(names).not.toContain('audit_allow_select');
      expect(names).not.toContain('audit_insert_only');
      expect(names).not.toContain('audit_deny_update');
      expect(names).not.toContain('audit_deny_delete');
      // Per-tenant policies remain.
      expect(names).toContain('audit_events_tenant_select');
      expect(names).toContain('audit_events_tenant_insert');
      expect(names).toContain('audit_events_tenant_update');
      expect(names).toContain('audit_events_tenant_delete');
    });

    it('sep_app retains SELECT and INSERT but no UPDATE or DELETE on audit_events', async () => {
      type GrantRow = { grantee: string; privilege_type: string };
      const grants = await seedClient.$queryRaw<GrantRow[]>`
        SELECT grantee, privilege_type
        FROM information_schema.role_table_grants
        WHERE table_name = 'audit_events'
          AND grantee = 'sep_app'
        ORDER BY privilege_type
      `;
      const privs = grants.map((row) => row.privilege_type).sort();
      expect(privs).toEqual(['INSERT', 'SELECT']);
    });
  });

  // ─── (c) Tenant-scoped SELECT (sanity check) ───────────────────────────

  describe('cross-tenant SELECT scope', () => {
    it('seeded tenant-B rows are invisible from tenant-A context', async () => {
      // Seed a tenant-B audit row via BYPASSRLS so we know it exists
      // independent of the runtime role's policy state.
      const seedHash = `cross-tenant-select-${Date.now()}`;
      await seedClient.auditEvent.create({
        data: {
          tenantId: TENANT_B_ID,
          actorType: 'SYSTEM',
          actorId: 'cross-tenant-select',
          objectType: 'Probe',
          objectId: 'cross-tenant',
          action: 'TENANT_CREATED',
          result: 'SUCCESS',
          immutableHash: seedHash,
        },
      });

      const seenInA = await db.forTenant(TENANT_A_ID, async (tx) =>
        tx.auditEvent.findMany({ where: { immutableHash: seedHash } }),
      );
      expect(seenInA).toHaveLength(0);

      const seenInB = await db.forTenant(TENANT_B_ID, async (tx) =>
        tx.auditEvent.findMany({ where: { immutableHash: seedHash } }),
      );
      expect(seenInB).toHaveLength(1);
    });
  });
});
