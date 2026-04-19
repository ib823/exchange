# M3.A2 Execution Prompt — Audit transactional coupling

**Status:** Canonical execution spec for M3.A2
**Plan reference:** `_plan/M3_EXECUTION_PLAN.md` §5 M3.A2-T01 through M3.A2-T04
**Created:** 2026-04-19 (committed during the M3.A2 session per the convention M3.A1 established)
**Closes:** issue #26 (drop M3.0 baseline audit_events policies)

## 0. Why this file exists

M3.A1 established the convention that each milestone's execution prompt is committed to `_plan/` rather than living only in chat. This file captures the M3.A2 plan as executed, the call-site migration table, the resolved stop-and-report cases, and the gotchas surfaced during execution. Future M3 milestones should follow the same pattern.

## 1. Scope

M3.A2 is "Audit transactional coupling." Four entwined concerns, executed as five atomic commits:

1. **T01** — `AuditService.record` and `AuditWriterService.record` accept a `tx` parameter (`Prisma.TransactionClient | PrismaClient`). When tx is a `TransactionClient`, the audit append shares the caller's transaction. When tx is a `PrismaClient`, the service falls back to `DatabaseService.forTenant` for backward compatibility — not exercised by any current call site after T02.

2. **T02** — All audit write call sites migrated to pass the parent `tx`. Two flavors:
   - **18 control-plane + 10 data-plane sites** — already inside `database.forTenant(tenantId, async (db) => {...})`. Migration is `await this.audit.record(db, {...})` instead of `await this.audit.record({...})`.
   - **3 tenants.service.ts sites** — platform-scope writes that previously bypassed `forTenant`. Migrated to a new `DatabaseService.forSystemTx(tenantIdForAudit, fn)` helper.

3. **T03** — Migration `20260419083423_audit_events_restore_insert_drop_baseline`:
   - `GRANT INSERT ON audit_events TO sep_app` (reverses PR #23's REVOKE).
   - `DROP POLICY` on `audit_allow_select`, `audit_insert_only`, `audit_deny_update`, `audit_deny_delete`. Each guarded by a `pg_policies` existence check for idempotency.

4. **T04** — Integration tests: atomicity (rollback on thrown audit step), append-only (triggers + REVOKEs verified via pg_trigger / information_schema), tenant-scoped SELECT.

## 2. Append-only enforcement: defense-in-depth (a)+(c), drop (b)

The user (Claude.ai) approved **defense-in-depth**: keep both the GRANT-layer REVOKE (option a, from migration 20260418222953) AND the BEFORE UPDATE / BEFORE DELETE triggers (option c, from migration 20260412140000). Drop the redundant deny-all RLS policies (option b).

Reasoning:
- The REVOKE prevents sep_app from issuing UPDATE/DELETE statements at all — fastest, simplest layer.
- The triggers raise `audit_events is append-only` even if a future grant change accidentally re-enables UPDATE/DELETE — survives policy/grant drift.
- Keeping the RLS deny-all policies adds zero behaviour beyond the REVOKE/trigger pair and was the OR-defeat vector that PR #23 had to work around.

Post-migration audit_events state:
- 4 per-tenant policies: `audit_events_tenant_{select,insert,update,delete}`
- sep_app grants: `SELECT, INSERT` (UPDATE, DELETE remain revoked)
- 2 triggers: `audit_events_no_update`, `audit_events_no_delete`

## 3. forSystemTx — tenants.service.ts resolution

The stop-and-report case from the proposal: `tenants.service.ts` has three audit call sites (`create`, `update`, `suspend`) that operate at platform scope and previously used `database.forSystem()`. They cannot use `forTenant()` because the tenant id may not exist yet (in `create`).

Resolved with **option (iii) — new helper**: `DatabaseService.forSystemTx(tenantIdForAudit, fn)`. Two modes:

```typescript
// Mode 1 — id known up front (update, suspend):
return this.database.forSystemTx(id, async (tx) => {
  const updated = await tx.tenant.update({...});
  await this.audit.record(tx, {...});  // RLS context already set
  return updated;
});

// Mode 2 — id materialised inside the tx (create):
return this.database.forSystemTx(null, async (tx) => {
  const tenant = await tx.tenant.create({...});
  await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenant.id}, true)`;
  await this.audit.record(tx, {...});
  return tenant;
});
```

When `tenantIdForAudit` is provided, `forSystemTx` issues `set_config('app.current_tenant_id', tenantIdForAudit, true)` before the callback. When null, the caller is responsible for setting context manually after the platform write that produces the id. Audit writes without context fail the `audit_events_tenant_insert` WITH CHECK — which is the correct signal that such operations should not audit inside this wrapper.

Validation: when `tenantIdForAudit` is non-null, it must be a valid cuid (same `CuidSchema` check as `forTenant`).

## 4. Call-site migration map

| File | Sites | Pattern |
|---|---|---|
| `apps/control-plane/src/modules/key-references/key-references.service.ts` | 7 | `await this.audit.record(db, {...})` |
| `apps/control-plane/src/modules/partner-profiles/partner-profiles.service.ts` | 3 | same |
| `apps/control-plane/src/modules/submissions/submissions.service.ts` | 2 | same |
| `apps/control-plane/src/modules/incidents/incidents.service.ts` | 2 | same |
| `apps/control-plane/src/modules/webhooks/webhooks.service.ts` | 2 | same |
| `apps/control-plane/src/modules/approvals/approvals.service.ts` | 2 | same |
| `apps/control-plane/src/modules/tenants/tenants.service.ts` | 3 | `forSystemTx` (see §3) |
| `apps/data-plane/src/processors/intake.processor.ts` | 2 | `await this.auditWriter.record(db, {...})` |
| `apps/data-plane/src/processors/delivery.processor.ts` | 3 | same |
| `apps/data-plane/src/processors/inbound.processor.ts` | 4 | same |
| `apps/data-plane/src/processors/crypto.processor.ts` | 1 | same |
| **Total** | **31** | |

All control-plane and data-plane callers (28 sites) use `db` as the variable name inside their `forTenant` blocks — single-replace migration with no per-site edits required. Tenants.service.ts (3 sites) is the only file requiring structural changes for the `forSystemTx` adoption.

## 5. Test mock updates

Seven control-plane service test files assert `mockAudit.record` calls. The migration changed the assertion shape:

```typescript
// Before:
expect(mockAudit.record).toHaveBeenCalledWith(
  expect.objectContaining({...}),
);

// After:
expect(mockAudit.record).toHaveBeenCalledWith(
  expect.anything(),  // tx parameter
  expect.objectContaining({...}),
);
```

Updated files: approvals, incidents, key-references, partner-profiles, submissions, webhooks, tenants. Single replace_all per file.

`tenants.service.test.ts` additionally needed:
- `mockDatabaseService.forSystemTx` mock that mirrors the helper's contract (validates id, calls callback with mockDb).
- `mockDb.$executeRaw` mock (returns `Promise<void>`) because tenants.service.create issues SET LOCAL via `tx.$executeRaw` before audit.record.

`audit.service.test.ts` gained two new tests:
- TransactionClient branch must NOT call `DatabaseService.forTenant` (audit shares caller's tx).
- PrismaClient branch (mock with `$transaction`) MUST delegate to `DatabaseService.forTenant` for atomicity + RLS context.

## 6. Integration test additions

Two changes under `tests/integration/rls-negative-tests/`:

1. `audit-events.rls-negative.test.ts` — flipped the two SELECT assertions PR #23's TODOs anticipated:
   - `SELECT without tenant context` returns 0 (was: > 0; baseline `audit_allow_select` is gone).
   - `SELECT in tenant-A context for a tenant-B row` returns 0 (was: > 0).
   - INSERT assertions: error class shifted from `/permission denied/i` (grant-layer) to `/row-level security/i` (tenant_insert WITH CHECK) — sep_app now has INSERT grant; the WITH CHECK is what enforces tenant boundary.
   - UPDATE/DELETE assertions: unchanged — sep_app still has no UPDATE/DELETE grant.
   - New positive assertion: INSERT in tenant-A context with tenantId=A succeeds. Explicitly demonstrates the closed regression.

2. `audit-transactional-coupling.test.ts` (new): three test groups — atomicity (rollback on thrown step + happy path), append-only (triggers + grants + dropped policies verified via pg system catalogues), cross-tenant SELECT scope sanity check.

`vitest.config.ts` `include` pattern broadened to also match `audit-transactional-coupling.test.ts` (the only file in the suite that isn't named `*.rls-negative.test.ts`).

Test totals after this milestone:
- Control-plane unit: 116 tests (10 files), unchanged count (test mocks updated, no new tests beyond the two AuditService branch-discrimination cases — net +2 → 116 includes those).
- Data-plane unit: 72 tests (9 files), unchanged.
- DB unit: 11 tests passing + 12 skipped (4 files).
- rls-negative integration: 152 tests (19 files), up from 144 / 18.

## 7. Gotchas surfaced during execution

1. **`PrismaClient` not exported from `@sep/db`.** The audit service signature needed `PrismaClient` as a type to discriminate the union. Resolved by adding `export type { PrismaClient } from '@prisma/client';` to `packages/db/src/client.ts` (type-only — the runtime singleton stays gated behind `getPrismaClient()` per the file's existing convention).

2. **`tsup` returns success but `tsc -b` may not run reliably under `&&`.** The `pnpm build` script in `packages/db` is `tsup ... --clean && tsc -b`. On the first invocation after a clean it sometimes leaves `dist/` with `.d.ts.map` files but no `.d.ts` files. Workaround: re-run `tsc -b` separately (or `rm -rf dist && pnpm build` followed by `pnpm exec tsc -b`). Same pattern as M3.A1 issue #21 — not blocking M3.A2 but worth tracking.

3. **`forSystemTx(null, ...)` set_config timing.** `tx.$executeRaw\`SELECT set_config(...)\`` must run AFTER the platform write that produces the tenant id but BEFORE any audit append in the same callback. The contract is that the caller orders these correctly — `forSystemTx` itself only sets context up front when `tenantIdForAudit` is non-null. The convention is documented inline on the helper and demonstrated in `tenants.service.create`.

4. **Vitest `include` patterns are AND-or-nothing.** The rls-negative-tests vitest config originally globbed `**/*.rls-negative.test.ts`. The new `audit-transactional-coupling.test.ts` does not match. Resolution: add it as a second pattern. Renaming the file to `*.rls-negative.test.ts` would have been misleading (it's atomicity, not RLS-negative).

5. **`audit_deny_*` was load-bearing for audit_events RLS even with the per-tenant policies in place.** This was discovered in M3.A1's PR #23 round-3 re-read and fixed structurally with the REVOKE INSERT + REVOKE UPDATE/DELETE. M3.A2 confirms that with the per-tenant policies and triggers in place, the `audit_deny_*` policies are now redundant and safe to drop. The OR-combination semantics that bit M3.A1 do not bite M3.A2 because every dropped policy was permissive (`USING true` / `WITH CHECK true` for select/insert) or restrictive in a way that grant-layer + triggers replicate (`USING false` for update/delete).

## 8. Closing artefact list

Commits on `m3.a2/audit-transactional-coupling`:

1. `feat(m3.a2-t01): AuditService.record accepts tx parameter`
2. `feat(m3.a2-t02): transactionally couple audit writes to business writes`
3. `feat(m3.a2-t03): restore INSERT grant + drop M3.0 baseline audit policies`
4. `test(m3.a2-t04): integration tests for transactional coupling + append-only`
5. `docs(m3.a2-t05): execution prompt + gotcha index`

PR body MUST include:
- "Closes #26"
- §10.1(ii) self-review block with commit-by-commit diff scan and any findings.

## 9. After merge

M3.A2 is closed. M3.A3 opens in a fresh session. Follow the same pattern: commit `_plan/M3_A3_EXECUTION_PROMPT.md` at the start of the milestone.
