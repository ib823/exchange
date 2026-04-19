# M3.A1 Execution Prompt — Database tenant isolation (RLS)

**Status:** Canonical execution spec for M3.A1
**Plan reference:** `_plan/M3_EXECUTION_PLAN.md` §5 M3.A1-T01 through M3.A1-T06
**Created:** 2026-04-18 (initial session)
**Amended:** 2026-04-19 (committed to `_plan/` after the first session surfaced that the prompt had been chat-only; see §0)

## 0. Why this file exists

M3.A1's first session ran successfully and landed T01 as commit `b608637`. On session resume, Claude Code stop-and-reported that `_plan/M3_A1_EXECUTION_PROMPT.md` was referenced as authoritative but didn't exist in the repo. This file is the committed version of what had previously lived only in chat — closing that gap so the spec is durable across sessions, bisectable, and readable six months from now.

The execution content below is identical to the first session's spec. Only the scaffolding (chat-extraction markers, user-facing notes) has been removed.

Future M3 milestones (M3.A2 through M3.A10) should follow this pattern: the execution prompt gets committed to `_plan/` at the start of the milestone, not left in chat.

## 1. Role and scope

You are executing M3.A1 of the Malaysia Secure Exchange Platform (SEP). The authoritative plan is `_plan/M3_EXECUTION_PLAN.md` at main commit `5a5f0c1`. Read §5 M3.A1 in full before starting any task. Also read §2.1 (tenancy model), §7.1 (Prisma model additions), §7.4 (migration ordering), and §10.1 (self-review discipline) — these are prerequisite context.

M3.A1 is "Database tenant isolation (RLS)." Scope is strictly tasks T01–T06 per plan §5. Not executing M3.A2 or later in this session.

## 2. Repository state at start (initial session — 2026-04-18)

- Main HEAD: `5a5f0c1` (merge commit of PR #20)
- Tag `post-m3.0-baseline` at `ca5d3d9` (historical reference)
- M3.A0 closed: issue #16 closed; `verify-m3-0-findings.mjs` exits 0 (25/0/0)
- Main CI: 8/8 green on push-to-main
- Open issues:
  - #8 — tests/helpers lint scope (M3.A8; NOT this session)
  - #18 — format:check not in lefthook (M3 dev-workflow; NOT this session)
  - #19 — develop branch referenced but doesn't exist (M3 followup; NOT this session)
  - #21 — build pipeline stale tsbuildinfo (filed during first session; NOT blocking this work)

**Resume state (if starting from a cleared session after the first session's T01 landed):**

- Branch: `m3.a1/rls-tenant-isolation` (pushed to `origin`, tracking set)
- T01 committed: `b608637` (`feat(m3.a1): separate sep_app runtime role from migration role`)
- Remaining: T02, T03, T04, T05, T06, PR creation
- Pre-execution checklist §4 already passed once in the first session; safe to skip items 1–6, but re-run item #7 (Tenant.id type confirmation) if `schema.prisma` has been touched since
- Build-pipeline workaround: `rm -rf <pkg>/dist/` before `pnpm run build` if seeing stale tsbuildinfo (issue #21 tracks proper fix)

## 3. Critical correction to plan §2.1 and §7.4

Plan §2.1 RLS policy pattern shows `current_setting('app.current_tenant_id', true)::uuid`. **This is wrong.** `Tenant.id` in the current schema is `@default(cuid())`, not UUID. Casting a cuid to UUID via `::uuid` throws on every non-NULL value — so policies written with that pattern would reject every query, not just unauthenticated ones.

Use this corrected policy pattern:

```sql
CREATE POLICY <table>_tenant_select ON <table>
  FOR SELECT USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
  );
```

Why this works:

- `current_setting('app.current_tenant_id', true)` returns empty string when unset (the `true` parameter makes it non-throwing)
- `NULLIF(value, '')` converts the empty string to NULL
- `tenant_id = NULL` evaluates to NULL under SQL three-valued logic — the row is NOT returned (fail-closed)
- When tenant is set, comparison is string-to-string against a cuid column — this works correctly

Apply this same pattern to all four operations (SELECT, INSERT, UPDATE, DELETE). For INSERT WITH CHECK and UPDATE WITH CHECK, wrap the same NULLIF expression.

The corresponding runtime contract: `SET LOCAL app.current_tenant_id = '<tenant-cuid>'` — pass the raw cuid string, no casting. If tenantId validation is desired at the service layer (and it should be), use Zod `.regex(/^c[a-z0-9]{24,}$/)` or the cuid library's validator — NOT UUID regex.

If during execution this pattern doesn't work against actual Prisma session behavior (e.g., pg connection pooling recycles session vars in an unexpected way), STOP AND REPORT — systems-level behavior worth discussing before improvising.

## 4. Pre-execution safety checklist

Run before starting T01. If any check fails, STOP AND REPORT before making any change.

Skip checks 1–6 on session resume (the first session already passed them). Always re-run check #7.

1. Branch and main state clean:

   ```
   git fetch origin
   git log --oneline origin/main -5     # expect: 5a5f0c1 as HEAD
   ```

2. Baseline gates pass on main:

   ```
   pnpm install --frozen-lockfile
   pnpm run typecheck     # expect: 15/15
   pnpm run lint          # expect: 15/15
   pnpm run format:check  # expect: pass
   pnpm run build         # expect: 9/9
   pnpm run test:unit     # expect: 14/14
   node _plan/scripts/verify-m3-0-findings.mjs   # expect: 25/0/0 exit 0
   ```

3. M3.A0 `tsc -b` still works (T01–T04 output):

   ```
   pnpm exec tsc -b tsconfig.solution.json    # expect: exit 0
   ```

4. Infra containers reachable:

   ```
   docker compose up -d postgres redis
   docker compose ps     # expect: both healthy
   ```

5. Current Prisma schema is migrate-deploy clean:

   ```
   docker compose exec postgres psql -U <admin-user> -c "DROP DATABASE IF EXISTS sep_test;"
   docker compose exec postgres psql -U <admin-user> -c "CREATE DATABASE sep_test;"
   DATABASE_URL=postgres://.../sep_test pnpm prisma migrate deploy
   # expect: all existing migrations apply cleanly, exit 0
   ```

6. Test Postgres admin role is reachable for creating `sep` and `sep_app` roles during T01.

7. Tenant.id type (ALWAYS re-run on session resume):
   ```
   grep -A 2 "model Tenant {" packages/db/prisma/schema.prisma | head -5
   # expect: "id  String  @id @default(cuid())" — NOT @default(uuid())
   # Confirms the §3 correction is still needed.
   ```

## 5. Absolute rules

1. **Scope lock.** Execute ONLY M3.A1-T01 through M3.A1-T06 per plan §5 acceptance criteria. Anything that looks adjacent but is §M3.A2+ scope — stop and escalate.

2. **One task per commit**, except where a within-scope follow-up emerges (same T01b / T03b pattern used in M3.A0 is acceptable).

3. **Option (ii) self-review discipline activates.** Per plan §10.1, any PR touching `packages/db/prisma/migrations/`, `packages/crypto/`, or `apps/control-plane/src/modules/auth/` requires a self-review block. M3.A1-T02 is the first commit in this PR touching the first of those paths. Self-review mechanics in §8.

4. **Stop-and-report triggers:**
   - Any acceptance criterion in plan §5 can't be met as written
   - Any local gate fails (`pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, `pnpm run build`, `pnpm run test:unit`)
   - Any migration test failure that isn't obviously a fixture problem
   - Any unexpected Postgres error during RLS policy creation
   - Any pg connection pool recycling / SET LOCAL scope surprise
   - §3 correction proves insufficient or produces unexpected behavior
   - Any specific RLS gotcha in §7 surfaces

5. **No gate bypass.** No `--no-verify` commits. No commenting out failing tests.

6. **Branch strategy.** Branch `m3.a1/rls-tenant-isolation` (already exists on origin from first session). All T-task commits land on it. ONE PR at end of M3.A1, not per-task.

## 6. Task-by-task execution order

Plan §5 M3.A1-T01 through M3.A1-T06 in order. Plan's acceptance criteria are binding. This prompt adds context and gotchas; it does not replace plan.

**T01 — Runtime role separation (`sep_app` vs `sep`)** — Already committed as `b608637` in the first session. Skip on resume.

**T02 — Denormalize tenantId onto FK-scoped tables**

Per plan §5. Schema + migration. Two tables get new `tenantId` column: `delivery_attempts` (backfill from `submission.tenantId`), `webhook_delivery_attempts` (backfill from `webhook.tenantId`, fallback to `submission.tenantId` when `webhookId` is null).

Backfill in the migration, not in application code. Add `@@index([tenantId])` on both tables. Plan acceptance criteria are the bar.

**This is the first PR-candidate commit touching `packages/db/prisma/migrations/`.** Self-review discipline activates from T02 onward for every migration commit. Self-review block gets written at PR creation (after T06), not on each commit.

**T03 — Add RefreshToken model with denormalized tenantId**

Per plan §5. New model with tenantId from creation. RLS policies for RefreshToken are in THIS migration, not a follow-up — consistency-by-construction.

**T04 — Enable RLS + policies on all 18 tables**

Per plan §5. High-volume mechanical migration (72 policies: 18 tables × 4 operations). Must be atomic (`BEGIN ... COMMIT`). Use the CORRECTED policy pattern (NULLIF-based, not UUID-cast) per §3.

After migration applies:

```sql
SELECT tablename, policyname, cmd FROM pg_policies ORDER BY tablename, policyname;
-- Expect: 72 rows, 4 per table × 18 tables
```

**T05 — DatabaseService.forTenant() with SET LOCAL**

Per plan §5. Runtime path for setting tenant session variable. Uses `$transaction`. Throws `SepError.of('TENANT_CONTEXT_INVALID', ...)` on malformed tenantId — but since tenantId is cuid, validation is cuid-shaped, not UUID-shaped. If existing schemas already have a cuid validator, reuse; otherwise add one to `packages/schemas/`.

Integration test: tenant A context queries return only tenant A rows; tenant B rows invisible even in the same table.

**T06 — Cross-tenant negative test suite**

Per plan §5. 144 assertions (18 tables × 8 operations). New directory `tests/integration/rls-negative-tests/`.

Use a test helper to generate 8 assertions per table consistently; don't hand-write 144 nearly-identical test bodies. Pattern:

```typescript
// tests/integration/rls-negative-tests/_helpers/rls-assertions.ts
export function assertsRlsOnTable(tableName: string, seedFn: ...) {
  it(`${tableName}: SELECT without tenant context returns 0 rows`, async () => { ... });
  it(`${tableName}: INSERT without tenant context fails`, async () => { ... });
  // ... 6 more
}
```

Each of 18 per-table files calls `assertsRlsOnTable('users', ...)` etc.

## 7. RLS gotcha index

Before writing any RLS policy or SET LOCAL call, internalize this list. If you find yourself working on anything resembling one of these, slow down:

1. **Forgotten `FORCE ROW LEVEL SECURITY`.** `ENABLE ROW LEVEL SECURITY` alone allows superusers (and table owner) to bypass policies. `FORCE` is required for policies to apply to all roles. Every table in T04 needs BOTH `ENABLE` and `FORCE`.

2. **Wrong NULL-handling in policy expression.** The §3 corrected pattern (NULLIF + string comparison) fails closed on empty/unset. Deviating from this pattern risks silent-leak — SELECT without tenant context returning all rows.

3. **SET LOCAL scope vs SET scope.** `SET LOCAL` is transaction-scoped; `SET` is session-scoped. With pg connection pooling, `SET` leaks tenant context across unrelated requests on the same connection. Use `SET LOCAL` exclusively inside `$transaction`.

4. **Policy creation outside transaction during T04.** T04 creates 72 policies across 18 tables. Without `BEGIN ... COMMIT`, a failure partway leaves the database with partial policies — a hybrid state worse than either all-on or all-off. Migration MUST be atomic.

5. **Prisma and SET LOCAL interaction.** Prisma's `$transaction` wraps queries in BEGIN/COMMIT. `SET LOCAL` inside is scoped to that transaction. BUT: verify Prisma issues the `$executeRaw SET LOCAL` and subsequent queries on the same pool connection. Use `$queryRaw("SELECT current_setting('app.current_tenant_id', true)")` right before and right after the SET LOCAL to confirm.

6. **BYPASSRLS attribute on the wrong role.** `sep_app` (runtime) MUST NOT have `BYPASSRLS`. `sep` (migration) MAY have `BYPASSRLS` — but per Postgres defaults, the database owner has implicit BYPASSRLS regardless of attribute setting. Confirm with:

   ```sql
   SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname IN ('sep', 'sep_app');
   ```

7. **WITH CHECK vs USING for UPDATE and INSERT.** UPDATE policy needs BOTH `USING` (which rows are visible to update) and `WITH CHECK` (what the row must look like after update). INSERT policy only needs `WITH CHECK`. Missing `WITH CHECK` on UPDATE allows moving a row FROM tenant A TO tenant B — a subtle data-leak variant.

8. **Testing RLS with the wrong role.** Integration tests must connect as `sep_app`, NOT the Postgres superuser. Superusers have implicit BYPASSRLS; tests running as superuser will show all rows regardless of policy and give false confidence.

9. **Migration reversibility.** Plan §7.4 specifies: "Migration's `down` disables policies rather than dropping." Use `DISABLE ROW LEVEL SECURITY` in down migrations — reversible by re-enabling. `DROP POLICY` requires knowing full policy body to recreate.

10. **Policy naming.** Plan pattern is `<table>_tenant_<op>` (e.g., `users_tenant_select`). Postgres scopes policy names per-table, so two tables can both have `<t>_tenant_select` without collision. Stick to the plan pattern; don't deviate.

11. **OR-defeat by pre-existing permissive policies.** Postgres combines permissive policies with OR. A pre-existing `<table>_allow_select` USING (true) (or `_allow_insert` WITH CHECK (true)) from an earlier migration will OR-combine with a new `<table>_tenant_select` and silently defeat tenant isolation — the OR result is `true OR <tenant predicate>` = `true`. When adding RLS to a table, audit the full current policy list on that table (`SELECT polname, polcmd FROM pg_policy p JOIN pg_class c ON p.polrelid = c.oid WHERE c.relname = '<t>'`) and ensure no `USING (true)` or `WITH CHECK (true)` policies exist that would OR-combine to defeat tenant isolation. Fix either by dropping the permissive policies or by REVOKE at the grant layer if the writes should remain privileged. PR #23's round-3 re-read caught this for `audit_events`; M3.A1-T06 surfaced the same gap on `crypto_operation_records` (issue #28, fixed in PR #29). `_deny_*` policies USING (false) are safe — `false OR <x>` = `<x>`, so they don't OR-defeat anything; they're inert when a tenant policy is present.

## 8. Self-review mechanics — option (ii)

**When to write the self-review block:** at PR creation, not at merge time. The block goes in the PR body.

**What the block must contain** (three sub-headings, each with substantive content):

```markdown
## Self-review (§10.1 option ii)

### Threat model considered

What attack surface does this change touch? Which OWASP API Top 10 2023
category is relevant? If none, state explicitly.

- Attack surface: [specific, not generic]
- OWASP category: [e.g., A01:2021 Broken Access Control, or "not applicable because X"]
- CWE relevant: [e.g., CWE-284]

### Test coverage added

What tests prove this change behaves correctly? What negative/failure
cases are covered? If a class of failure is NOT covered, say why (and
file a follow-up issue if meaningful).

- Tests added: [file names + assertion counts]
- Negative cases covered: [enumerate]
- Not covered: [enumerate + rationale]

### Rollback path documented

If this change is bad, what's the fix? Migration reversal? Feature-flag
toggle? Re-deploy previous commit? Some changes are not rollback-safe —
if so, state explicitly and name compensating controls.

- Rollback method: [e.g., prisma migrate reset + replay without T04 migration]
- Compensating controls if not rollback-safe: [if applicable]
```

**Before requesting self-approval:**

1. Write the block in the PR body at PR creation time.
2. Wait overnight if possible; minimum 2 hours between writing and re-reading.
3. Re-read your own PR body with fresh eyes, particularly the self-review block.
4. If re-reading surfaces a gap (missed threat-model angle, untested case, glossed rollback step) — either add commits to fix it OR explicitly note "known limitation" in the PR body.
5. Only after step 3–4, request self-review via GitHub UI (same action as requesting any CODEOWNER).
6. Approve and merge — but only after step 3–4 is satisfied.

If re-reading surfaces real concerns: STOP AND REPORT. Don't merge against your own doubt.

## 9. PR creation

After T06 commits:

- Open ONE PR from `m3.a1/rls-tenant-isolation` to `main`
- Title: `feat(m3.a1): database tenant isolation via RLS (PRIOR-R2-001 + PRIOR-R3-001)`
- Body sections:
  1. Summary — one paragraph
  2. Task table — T01–T06 with commit SHAs
  3. **Self-review (§10.1 option ii)** — three sub-sections per §8
  4. Verify output — re-run `verify-m3-0-findings.mjs`, expected still 25/0/0
  5. Closures — `Closes PRIOR-R2-001 and PRIOR-R3-001 per milestone exit criteria`
  6. Follow-up issues — any surfaced during execution

**Wait overnight between PR creation and requesting self-approval.** Non-negotiable per §10.1.

## 10. End-of-session deliverables

Report in chat when ready for review:

1. PR number + URL
2. All commit SHAs in order
3. Verify script output from PR tip (expected still 25/0/0)
4. PR CI status (expected: 8/8 green + the new `rls-negative-tests` job if plan §9 required check was added)
5. Self-review block (copy-paste the three sub-sections from PR body)
6. Confirmation of overnight re-read period completed before requesting self-approval
7. Any stop-and-report items handled during session, summarized
8. Any new follow-up issues filed

Then stop. Do not merge without explicit approval. Do not proceed to M3.A2.
