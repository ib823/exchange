-- M3.A2-T03 — restore INSERT grant on audit_events to sep_app and drop
-- the M3.0 baseline policies that have been superseded by per-tenant
-- RLS policies (added by 20260418222953_enable_rls_tenant_tables) plus
-- the existing append-only triggers (added by
-- 20260412140000_audit_rls_complete).
--
-- Closes issue #26.
--
-- Background
-- ----------
-- M3.A1-T04 (PR #23) revoked INSERT, UPDATE, DELETE on audit_events from
-- sep_app to defuse a policy OR-defeat introduced when the per-tenant
-- INSERT/SELECT/UPDATE/DELETE policies were added alongside the M3.0
-- baseline policies (audit_insert_only WITH CHECK true, audit_allow_select
-- USING true, audit_deny_update USING false, audit_deny_delete USING false).
-- Postgres OR-combines permissive policies; the audit_allow_select policy
-- USING (true) defeats the per-tenant SELECT policy; the
-- audit_insert_only WITH CHECK (true) defeats the per-tenant INSERT
-- policy. The REVOKE was a temporary structural fix that left audit
-- writes failing at runtime — a regression PR #23 documented and PR #27
-- amended.
--
-- M3.A2 (this milestone):
--   T01 — AuditService.record accepts a tx parameter
--   T02 — every audit.record caller now passes the parent tx so the
--         audit append shares the caller's transaction
--   T03 — this migration: restore INSERT for sep_app and drop the
--         redundant M3.0 baseline policies
--
-- Append-only enforcement after this migration
-- --------------------------------------------
-- audit_events writes remain locked down by two independent layers:
--   (1) GRANT layer: REVOKE UPDATE, DELETE ON audit_events FROM sep_app
--       (from migration 20260418222953) — sep_app structurally cannot
--       issue UPDATE or DELETE statements regardless of RLS state.
--   (2) Trigger layer: BEFORE UPDATE / BEFORE DELETE triggers
--       audit_events_no_update / audit_events_no_delete RAISE
--       EXCEPTION 'audit_events is append-only' (from migration
--       20260412140000) — survives any RLS or grant drift.
--
-- The two layers are belt-and-suspenders. Either alone would prevent
-- mutation of past audit events.
--
-- Atomicity: each DROP POLICY is wrapped in a DO $$ ... END $$ block
-- guarded by pg_policies existence so the migration is idempotent and
-- safe to re-run if a partial application leaves state inconsistent.

-- 1. Restore INSERT grant on audit_events for sep_app.
--    AuditService writes will now succeed via the per-tenant
--    audit_events_tenant_insert WITH CHECK policy (added by
--    20260418222953), which validates that the inserted row's tenantId
--    matches current_setting('app.current_tenant_id', true).
GRANT INSERT ON "audit_events" TO sep_app;

-- 2. Drop M3.0 baseline policies that the per-tenant policies now
--    supersede. Each is verified via pg_policies before dropping so
--    re-runs do not error.

-- audit_allow_select USING (true) — defeats audit_events_tenant_select
-- via OR-combination. Drop so SELECT correctly scopes to the caller's
-- tenant. Compliance reviewers gain authority via role grants and
-- explicit cross-tenant queries from the audit search service, not from
-- a permissive RLS policy.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'audit_events' AND policyname = 'audit_allow_select'
  ) THEN
    DROP POLICY audit_allow_select ON audit_events;
  END IF;
END $$;

-- audit_insert_only WITH CHECK (true) — defeats
-- audit_events_tenant_insert via OR-combination. Drop so INSERT
-- correctly requires the inserted row's tenantId to match
-- app.current_tenant_id (set by forTenant / forSystemTx).
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'audit_events' AND policyname = 'audit_insert_only'
  ) THEN
    DROP POLICY audit_insert_only ON audit_events;
  END IF;
END $$;

-- audit_deny_update USING (false) — redundant with the REVOKE UPDATE
-- (grant layer) and the audit_events_no_update trigger (trigger layer).
-- Drop to remove the policy-layer redundancy; the audit_events_tenant_update
-- policy from 20260418222953 stays in place but cannot fire because
-- sep_app has no UPDATE grant.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'audit_events' AND policyname = 'audit_deny_update'
  ) THEN
    DROP POLICY audit_deny_update ON audit_events;
  END IF;
END $$;

-- audit_deny_delete USING (false) — redundant with the REVOKE DELETE
-- and the audit_events_no_delete trigger. Same reasoning as
-- audit_deny_update.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'audit_events' AND policyname = 'audit_deny_delete'
  ) THEN
    DROP POLICY audit_deny_delete ON audit_events;
  END IF;
END $$;

-- Post-migration audit_events policy state:
--   audit_events_tenant_select  — USING tenantId = current_tenant_id
--   audit_events_tenant_insert  — WITH CHECK tenantId = current_tenant_id
--   audit_events_tenant_update  — USING + WITH CHECK tenantId = current_tenant_id
--                                 (dead policy: sep_app has no UPDATE grant)
--   audit_events_tenant_delete  — USING tenantId = current_tenant_id
--                                 (dead policy: sep_app has no DELETE grant)
--
-- Post-migration grants for sep_app:
--   SELECT, INSERT (UPDATE, DELETE remain revoked)
--
-- Triggers (unchanged):
--   audit_events_no_update — BEFORE UPDATE → RAISE EXCEPTION
--   audit_events_no_delete — BEFORE DELETE → RAISE EXCEPTION

-- Rollback sketch (not executed — retained for reviewers):
--
-- REVOKE INSERT ON "audit_events" FROM sep_app;
--
-- DO $$ BEGIN
--   IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='audit_events' AND policyname='audit_insert_only') THEN
--     CREATE POLICY audit_insert_only ON audit_events FOR INSERT WITH CHECK (true);
--   END IF;
-- END $$;
--
-- DO $$ BEGIN
--   IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='audit_events' AND policyname='audit_allow_select') THEN
--     CREATE POLICY audit_allow_select ON audit_events FOR SELECT USING (true);
--   END IF;
-- END $$;
--
-- DO $$ BEGIN
--   IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='audit_events' AND policyname='audit_deny_update') THEN
--     CREATE POLICY audit_deny_update ON audit_events FOR UPDATE USING (false);
--   END IF;
-- END $$;
--
-- DO $$ BEGIN
--   IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='audit_events' AND policyname='audit_deny_delete') THEN
--     CREATE POLICY audit_deny_delete ON audit_events FOR DELETE USING (false);
--   END IF;
-- END $$;
