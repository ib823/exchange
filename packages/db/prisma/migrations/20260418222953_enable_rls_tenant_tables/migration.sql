-- M3.A1-T04: Enable RLS + 4 policies (SELECT/INSERT/UPDATE/DELETE) on
-- all 17 remaining tenant-scoped tables. refresh_tokens was set up in
-- M3.A1-T03 (consistency-by-construction from its creating migration),
-- so it is NOT re-enabled here. End state after this migration:
--
--   17 tables × 4 tenant policies  = 68 policies (this migration)
--   refresh_tokens × 4              =  4 policies (T03)
--   audit_events existing deny/allow = 3 policies (baseline M3.0)
--                                    ────
--   total pg_policies rows          = 75
--
-- The 72 tenant-scoped policies demanded by plan §5-T04 acceptance are
-- 18 tables × 4 operations = 72. Those are 68 (this migration) + 4 (T03).
--
-- audit_events — RLS-semantics correction. Postgres combines permissive
-- policies with OR. Adding tenant_update and tenant_delete policies
-- alongside the M3.0 baseline deny-all policies would DEFEAT the
-- deny-all (tenant policy returning true OR deny-all returning false
-- evaluates to true), opening an append-violation vector that didn't
-- exist before this migration.
--
-- The fix (immediately after the DO $$ block): REVOKE UPDATE, DELETE,
-- INSERT ON audit_events FROM sep_app. This operates at the grant
-- layer, not RLS, and is not subject to OR-combination. Writes become
-- structurally impossible regardless of what any RLS policy says.
--
-- The tenant policies remain in place on audit_events for consistency
-- with the other 17 tables; they cannot fire because sep_app has no
-- write grants. M3.A2 will restore GRANT INSERT ON audit_events TO
-- sep_app (AuditService writes via parent transaction) and drop the
-- redundant M3.0 baseline deny-all RLS policies at that point.
--
-- Atomicity: wrapped in a DO $$ block so any failure rolls back the
-- entire migration. Plan §7 gotcha #4 — partial-state RLS across tables
-- would be worse than either all-on or all-off.
--
-- Policy predicate: NULLIF(current_setting('app.current_tenant_id', true), '')
-- rather than the plan §2.1 ::uuid cast. Tenant.id is @default(cuid()),
-- not UUID — ::uuid would throw on every valid tenant. See
-- _plan/M3_A1_EXECUTION_PROMPT.md §3 for the correction.
--
-- Rollback: prefer `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` over
-- `DROP POLICY` per plan §7.4 — disabling is reversible by re-enabling
-- without reconstructing policy bodies. The audit_events REVOKE is
-- reversible via `GRANT UPDATE, DELETE, INSERT ON audit_events TO
-- sep_app`. See the companion rollback sketch at the bottom of this
-- file (commented, not executed).

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'users',
    'role_assignments',
    'retention_policies',
    'source_systems',
    'partner_profiles',
    'exchange_profiles',
    'submissions',
    'inbound_receipts',
    'key_references',
    'crypto_operation_records',
    'audit_events',
    'incidents',
    'approvals',
    'webhooks',
    'api_keys',
    'delivery_attempts',
    'webhook_delivery_attempts'
  ];
BEGIN
  FOREACH t IN ARRAY tables
  LOOP
    -- Enable + FORCE: gotcha #1 — plain ENABLE lets the table owner
    -- bypass policies. FORCE applies them to every role including owner.
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);

    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING ("tenantId" = NULLIF(current_setting(''app.current_tenant_id'', true), %L))',
      t || '_tenant_select',
      t,
      ''
    );

    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT WITH CHECK ("tenantId" = NULLIF(current_setting(''app.current_tenant_id'', true), %L))',
      t || '_tenant_insert',
      t,
      ''
    );

    -- UPDATE needs BOTH USING and WITH CHECK — gotcha #7. Without
    -- WITH CHECK, a row could be updated to move it FROM tenant A
    -- TO tenant B; USING alone only constrains which rows are visible
    -- for update, not the post-update state.
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE USING ("tenantId" = NULLIF(current_setting(''app.current_tenant_id'', true), %L)) WITH CHECK ("tenantId" = NULLIF(current_setting(''app.current_tenant_id'', true), %L))',
      t || '_tenant_update',
      t,
      '',
      ''
    );

    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE USING ("tenantId" = NULLIF(current_setting(''app.current_tenant_id'', true), %L))',
      t || '_tenant_delete',
      t,
      ''
    );
  END LOOP;
END $$;

-- audit_events write defense-in-depth — see header comment. Structural
-- append-only enforcement at the grant layer, immune to RLS OR-combination
-- with the M3.0 baseline deny-all policies. M3.A2 will restore INSERT
-- for AuditService and drop the now-redundant baseline policies.
REVOKE UPDATE, DELETE, INSERT ON "audit_events" FROM sep_app;

-- Rollback sketch (not executed — retained for reviewers):
--
-- DO $$
-- DECLARE
--   t TEXT;
--   tables TEXT[] := ARRAY[...same list as above...];
-- BEGIN
--   FOREACH t IN ARRAY tables
--   LOOP
--     EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
--   END LOOP;
-- END $$;
--
-- GRANT UPDATE, DELETE, INSERT ON "audit_events" TO sep_app;
