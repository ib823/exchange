/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, no-await-in-loop */

/**
 * Threat scenario T14 — Audit chain tampering (M3.A8).
 *
 * Plan §6 scenario ID: T14. Primary control: REVOKE + RLS + hash-
 * chain verification.
 *
 * Three attack variants are exercised:
 *   1. UPDATE audit_events → blocked by `audit_events_no_update`
 *      trigger (defense-in-depth over the per-role REVOKE). The
 *      trigger RAISEs with SQLSTATE 42501 (insufficient_privilege).
 *   2. DELETE audit_events → blocked by `audit_events_no_delete`
 *      trigger, same mechanism.
 *   3. Forged INSERT with a broken previousHash — the DB triggers
 *      don't block arbitrary INSERTs (INSERT is the legitimate
 *      append path), so tamper detection happens at verification
 *      time. A hash-chain verifier re-derives each event's
 *      immutableHash from its predecessor and the hashSecret; a
 *      forged row shows up as a mismatch on its SUCCESSOR (the
 *      forgery's immutableHash != the next row's previousHash).
 *
 * No app internals needed — this scenario lives in
 * tests/threat-scenarios/ and exercises only the DB layer + the
 * @sep/common hashSecret config. The AuditService's hash algorithm
 * is re-implemented inline so the test is self-contained: future
 * changes to that algorithm would need to update both places,
 * which is the right signal (a future change that only touches one
 * would silently break the chain).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { hasPostgres, makeSeedClient, makeRuntimeClient } from './_helpers/clients';
import { TENANTS, ensureThreatTestTenants } from './_helpers/tenants';
import { scenarioTitle } from './_helpers/scenario-id';
import type { PrismaClient, AuditAction } from '@prisma/client';

const TENANT_ID = TENANTS.T14_audit_tamper_owner;
const HASH_SECRET = 'threat-scenario-test-audit-hash-secret-min32ch';

/**
 * Re-implements AuditService.record's hash derivation so the test
 * can seed a real chain without depending on the control-plane's
 * NestJS service boot. Inputs match AuditService exactly:
 *   sha256(tenantId|actorId|action|result|eventTime.toISOString()|
 *          previousHash or 'genesis'|hashSecret)
 */
function computeHash(input: {
  tenantId: string;
  actorId: string;
  action: string;
  result: string;
  eventTime: Date;
  previousHash: string | null;
}): string {
  const parts = [
    input.tenantId,
    input.actorId,
    input.action,
    input.result,
    input.eventTime.toISOString(),
    input.previousHash ?? 'genesis',
    HASH_SECRET,
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

interface AuditEventRow {
  id: string;
  tenantId: string;
  actorId: string;
  action: string;
  result: string;
  eventTime: Date;
  immutableHash: string;
  previousHash: string | null;
}

/**
 * Independent chain verifier. Walks events in eventTime order and
 * re-derives each row's immutableHash from the previous row +
 * hashSecret. Returns the first index where the derived hash
 * mismatches the stored hash, or -1 if the chain is intact.
 *
 * A successful forgery would need to rewrite every successor's
 * immutableHash too — but those rows are also protected by the
 * trigger, so the attacker cannot do so without privileged role
 * + a schema-level migration.
 */
function verifyChain(events: readonly AuditEventRow[]): number {
  for (let i = 0; i < events.length; i += 1) {
    const evt = events[i];
    if (evt === undefined) {
      continue;
    }
    const expectedPrev = i === 0 ? null : (events[i - 1]?.immutableHash ?? null);
    if (evt.previousHash !== expectedPrev) {
      return i;
    }
    const derived = computeHash({
      tenantId: evt.tenantId,
      actorId: evt.actorId,
      action: evt.action,
      result: evt.result,
      eventTime: evt.eventTime,
      previousHash: evt.previousHash,
    });
    if (evt.immutableHash !== derived) {
      return i;
    }
  }
  return -1;
}

describe.skipIf(!hasPostgres)(
  scenarioTitle(
    'T14',
    'audit chain tampering: UPDATE/DELETE blocked by trigger; forged INSERT caught by hash-chain verifier',
  ),
  () => {
    let seedClient: PrismaClient;
    let runtimeClient: PrismaClient;
    const actorId = 'ct14audittamperingactor01';

    beforeAll(async () => {
      seedClient = makeSeedClient();
      runtimeClient = makeRuntimeClient();
      await ensureThreatTestTenants(seedClient, ['T14_audit_tamper_owner']);
    }, 30_000);

    afterAll(async () => {
      // Can't DELETE — the append-only trigger blocks it regardless
      // of role. TRUNCATE bypasses triggers by schema privilege; the
      // sep migration role owns the table and is allowed to TRUNCATE.
      await seedClient.$executeRawUnsafe(`TRUNCATE TABLE audit_events RESTART IDENTITY CASCADE`);
      await seedClient.$disconnect();
      await runtimeClient.$disconnect();
    });

    beforeEach(async () => {
      // Clean slate: seedClient has BYPASSRLS so this works even
      // though the runtime role can't.
      // NB: we cannot use DELETE to clean up — the trigger forbids
      // DELETE regardless of role. Use raw TRUNCATE as a privileged
      // sep-role escape hatch.
      await seedClient.$executeRawUnsafe(`TRUNCATE TABLE audit_events RESTART IDENTITY CASCADE`);
    });

    async function seedEvent(
      actorSuffix: string,
      action: AuditAction,
      previousHash: string | null,
    ): Promise<AuditEventRow> {
      const eventTime = new Date();
      // Small stagger so eventTime ordering is deterministic across
      // successive seeds within one test.
      await new Promise((r) => setTimeout(r, 2));
      const immutableHash = computeHash({
        tenantId: TENANT_ID,
        actorId: `${actorId}-${actorSuffix}`,
        action,
        result: 'SUCCESS',
        eventTime,
        previousHash,
      });
      const row = await seedClient.auditEvent.create({
        data: {
          tenantId: TENANT_ID,
          actorType: 'USER',
          actorId: `${actorId}-${actorSuffix}`,
          actorRole: 'TENANT_ADMIN',
          objectType: 'Tenant',
          objectId: TENANT_ID,
          action,
          result: 'SUCCESS',
          eventTime,
          immutableHash,
          previousHash,
        },
      });
      return {
        id: row.id,
        tenantId: row.tenantId,
        actorId: row.actorId,
        action: String(row.action),
        result: row.result,
        eventTime: row.eventTime,
        immutableHash: row.immutableHash,
        previousHash: row.previousHash,
      };
    }

    it('UPDATE against audit_events is rejected by the append-only trigger', async () => {
      const genesis = await seedEvent('genesis', 'TENANT_CREATED', null);

      // Attempt UPDATE via the sep role (has BYPASSRLS) — the trigger
      // should fire anyway. Postgres triggers are NOT scoped by role;
      // they run for every statement that touches the table.
      await expect(
        seedClient.$executeRawUnsafe(
          `UPDATE audit_events SET "actorId" = 'hacker' WHERE id = $1`,
          genesis.id,
        ),
      ).rejects.toThrow(/append-only|insufficient_privilege/i);
    });

    it('DELETE against audit_events is rejected by the append-only trigger', async () => {
      const genesis = await seedEvent('genesis', 'TENANT_CREATED', null);
      await expect(
        seedClient.$executeRawUnsafe(`DELETE FROM audit_events WHERE id = $1`, genesis.id),
      ).rejects.toThrow(/append-only|insufficient_privilege/i);
    });

    it('forged INSERT with arbitrary immutableHash is INSERT-permitted but caught by chain verification', async () => {
      // Build a legitimate chain of 3 events.
      const e1 = await seedEvent('u1', 'TENANT_CREATED', null);
      const e2 = await seedEvent('u2', 'USER_CREATED', e1.immutableHash);
      const e3 = await seedEvent('u3', 'USER_CREATED', e2.immutableHash);

      // Verify the untampered chain passes.
      expect(verifyChain([e1, e2, e3])).toBe(-1);

      // Attacker INSERTs a forged event between e2 and e3, claiming
      // to chain off e2 but using an attacker-chosen hash. The DB
      // accepts the row (INSERT isn't blocked) — the tamper is only
      // visible at verification time because the NEXT event (e3)
      // still points at e2's real hash, not the forgery's.
      const forgedEventTime = new Date(e2.eventTime.getTime() + 1);
      const forgeryImmutableHash = 'f'.repeat(64); // attacker-chosen
      await seedClient.auditEvent.create({
        data: {
          tenantId: TENANT_ID,
          actorType: 'USER',
          actorId: `${actorId}-forger`,
          actorRole: 'TENANT_ADMIN',
          objectType: 'Tenant',
          objectId: TENANT_ID,
          action: 'USER_CREATED',
          result: 'SUCCESS',
          eventTime: forgedEventTime,
          immutableHash: forgeryImmutableHash,
          previousHash: e2.immutableHash,
        },
      });

      // Re-read in chain order.
      const rows = await seedClient.auditEvent.findMany({
        where: { tenantId: TENANT_ID },
        orderBy: { eventTime: 'asc' },
        select: {
          id: true,
          tenantId: true,
          actorId: true,
          action: true,
          result: true,
          eventTime: true,
          immutableHash: true,
          previousHash: true,
        },
      });
      expect(rows).toHaveLength(4);

      // The verifier walks the ordered events and returns the
      // first index where the derived hash mismatches the stored
      // hash. The forgery lives at index 2 (between e2 and e3); the
      // verifier catches it because `f...` != sha256(inputs +
      // hashSecret).
      const firstBadIndex = verifyChain(rows as unknown as readonly AuditEventRow[]);
      expect(firstBadIndex).toBe(2);
    });

    it('attempted UPDATE via runtime role (sep_app) also rejected', async () => {
      const genesis = await seedEvent('genesis', 'TENANT_CREATED', null);
      // runtimeClient connects as sep_app which has RLS enforced
      // AND lacks UPDATE grant on audit_events. Attempting this
      // combination hits the trigger (defense-in-depth) before
      // Postgres even reaches the RLS check.
      await expect(
        runtimeClient.$executeRawUnsafe(
          `UPDATE audit_events SET "actorId" = 'hacker' WHERE id = $1`,
          genesis.id,
        ),
      ).rejects.toThrow(/append-only|insufficient_privilege|permission denied/i);
    });
  },
);
