-- Drop OR-defeating permissive policies on crypto_operation_records.
--
-- The tenant_* policies from M3.A1-T04 (migration
-- 20260418222953_enable_rls_tenant_tables) provide correct tenant-scoped
-- RLS. The _allow_* policies dropped below were M2 baseline scaffolding
-- (from migration 20260413100000_add_crypto_operation_records) that
-- OR-defeats tenant isolation:
--
--   crypto_operation_records_allow_select USING (true)
--     OR-combines with tenant_select → SELECT returns ALL rows regardless
--     of app.current_tenant_id. sep_app can read across tenants.
--
--   crypto_operation_records_allow_insert WITH CHECK (true)
--     OR-combines with tenant_insert → INSERT accepts ANY tenantId
--     regardless of app.current_tenant_id. sep_app can write rows
--     attributed to other tenants.
--
-- This is the same class of bug that PR #23 (M3.A1-T04) round-3 re-read
-- caught for audit_events. PR #23 fixed audit_events via REVOKE at the
-- grant layer; it should have also swept the rest of the schema for the
-- same pattern. Only crypto_operation_records has it — audited during
-- M3.A1-T06 execution. See issue #28 for full analysis.
--
-- The deny_update / deny_delete policies remain. They are USING (false)
-- and only OR-combine to grant access when paired with a permissive
-- policy that returns true. tenant_update / tenant_delete return true
-- only when tenantId matches app.current_tenant_id, so the OR result
-- correctly enforces tenant isolation. M3.A2 may sweep these as part of
-- the broader audit_events deny-all cleanup, but they are harmless now.
--
-- Rollback: re-create the dropped policies. Down migration not wired
-- (prisma convention; manual SQL if true rollback ever needed).

DROP POLICY IF EXISTS "crypto_operation_records_allow_insert"
  ON "crypto_operation_records";

DROP POLICY IF EXISTS "crypto_operation_records_allow_select"
  ON "crypto_operation_records";
