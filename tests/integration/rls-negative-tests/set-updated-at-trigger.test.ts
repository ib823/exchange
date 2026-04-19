// M3.A3-T02: Integration tests for the DB-authored `"updatedAt"`
// trigger (migration 20260419101825_set_updated_at_trigger).
//
// Three concerns:
//
//   (a) Clock-skew / back-date defense — a direct-SQL UPDATE that
//       explicitly sets `"updatedAt" = '1990-01-01'` must return a
//       trigger-authored value of now(), not the client's value. This
//       is the core property R2-003 remediation claims.
//
//   (b) Happy path — an ORM update through Prisma also yields a
//       trigger-authored timestamp. Prisma's own `@updatedAt` sets
//       the value in the outgoing SQL; the trigger overwrites it.
//       Net: DB wins.
//
//   (c) Coverage — pg_trigger reports exactly 10 `set_updated_at_*`
//       triggers. Exact-count assertion is defense-in-depth against
//       future migration drift: if someone attaches the trigger to a
//       new mutable table without updating this test, or drops a
//       trigger without noticing, the count test fails loudly. Spot-
//       checks for a handful of table names guard against renaming.
//
// Scope deliberately narrow: this file proves the trigger mechanism on
// one table (users) and the attachment surface via pg_trigger. It does
// not re-verify each of the 10 tables individually — the trigger is a
// single function attached identically to every table, so one direct-
// SQL probe demonstrates the generic behavior.

import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ensureTestTenants,
  hasIntegrationEnv,
  makeSeedClient,
  TENANT_A_ID,
} from './_helpers/clients';

describe.skipIf(!hasIntegrationEnv)('M3.A3 set_updated_at trigger', () => {
  let seedClient: PrismaClient;

  beforeAll(async () => {
    seedClient = makeSeedClient();
    await ensureTestTenants(seedClient);
  });

  afterAll(async () => {
    // Probe users are deleted inline per test — nothing persistent to
    // clean up here.
    await seedClient.$disconnect();
  });

  // ─── (a) Clock-skew defense ────────────────────────────────────────────

  describe('direct-SQL UPDATE with back-dated "updatedAt"', () => {
    it('trigger overwrites client-supplied timestamp with now()', async () => {
      // Seed: create a user with a very old `updatedAt`. Seed uses the
      // migration role (sep, BYPASSRLS) so the row exists regardless of
      // runtime policy state.
      const email = `trigger-probe-skew-${Date.now()}@rls-negative.test`;
      const user = await seedClient.user.create({
        data: {
          tenantId: TENANT_A_ID,
          email,
          displayName: 'Trigger probe initial',
        },
      });

      const before = new Date();

      // Direct-SQL UPDATE that tries to back-date `updatedAt` to 1990.
      // $executeRaw bypasses Prisma's `@updatedAt` behavior — this is
      // the worst case for the trigger: a caller actively trying to
      // write a stale timestamp.
      await seedClient.$executeRaw`
        UPDATE users
        SET "displayName" = 'Trigger probe updated',
            "updatedAt"   = '1990-01-01 00:00:00'
        WHERE id = ${user.id}
      `;

      const after = new Date();

      const row = await seedClient.user.findUniqueOrThrow({ where: { id: user.id } });

      // Trigger-authored timestamp must be between test start and end.
      // If the trigger had not fired, the value would be '1990-01-01'.
      expect(row.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(row.updatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
      expect(row.displayName).toBe('Trigger probe updated');

      await seedClient.user.delete({ where: { id: user.id } });
    });
  });

  // ─── (b) Happy path via Prisma ─────────────────────────────────────────

  describe('Prisma-driven UPDATE (happy path)', () => {
    it('trigger also fires on Prisma-authored UPDATE statements', async () => {
      const email = `trigger-probe-prisma-${Date.now()}@rls-negative.test`;
      const user = await seedClient.user.create({
        data: {
          tenantId: TENANT_A_ID,
          email,
          displayName: 'Prisma probe initial',
        },
      });

      const before = new Date();
      const updated = await seedClient.user.update({
        where: { id: user.id },
        data: { displayName: 'Prisma probe updated' },
      });
      const after = new Date();

      // Prisma's @updatedAt writes a value; the trigger overwrites it.
      // Both paths converge on a server-clock value — the test cannot
      // distinguish which one won from the outside. What it can check
      // is that the final value is a valid server-clock reading, which
      // is the only invariant users of the column actually care about.
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(updated.updatedAt.getTime()).toBeLessThanOrEqual(after.getTime());

      await seedClient.user.delete({ where: { id: user.id } });
    });
  });

  // ─── (c) Attachment coverage ───────────────────────────────────────────

  describe('pg_trigger attachment coverage', () => {
    it('exactly 10 set_updated_at_* triggers exist', async () => {
      // Exact-count assertion: catches both directions of drift.
      //  * 9 = a trigger was dropped without updating this test
      //  * 11+ = trigger was attached to a new table without updating
      //          either this test or the migration's documented table
      //          list
      // Both are failure modes worth failing the gate on.
      type TriggerRow = { tgname: string; table_name: string };
      const triggers = await seedClient.$queryRaw<TriggerRow[]>`
        SELECT tgname, tgrelid::regclass::text AS table_name
        FROM pg_trigger
        WHERE tgname LIKE 'set_updated_at_%'
          AND NOT tgisinternal
        ORDER BY tgname
      `;

      expect(triggers).toHaveLength(10);

      // Spot-check three tables from different parts of the domain
      // (tenant identity, submission flow, ops). If the migration ever
      // renamed a trigger or a table the mapping would break here.
      const tableNames = triggers.map((row) => row.table_name);
      expect(tableNames).toContain('tenants');
      expect(tableNames).toContain('users');
      expect(tableNames).toContain('submissions');
    });

    it('append-only tables are deliberately excluded from the trigger', async () => {
      // Guardrail: if someone were to attach set_updated_at to
      // audit_events or crypto_operation_records, those tables would
      // start having their timestamps mutated — undermining the
      // append-only / immutable guarantee. Check the exclusion.
      type TriggerRow = { tgname: string };
      const triggers = await seedClient.$queryRaw<TriggerRow[]>`
        SELECT tgname
        FROM pg_trigger
        WHERE tgname LIKE 'set_updated_at_%'
          AND tgrelid::regclass::text IN ('audit_events', 'crypto_operation_records')
      `;
      expect(triggers).toHaveLength(0);
    });
  });
});
