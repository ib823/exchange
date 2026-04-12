-- Complete audit_events append-only enforcement.
-- Supplements the initial RLS migration (20260412071411_add_audit_rls).
--
-- Changes:
-- 1. FORCE ROW LEVEL SECURITY — applies policy to table owner as well
-- 2. Explicit DENY policies for UPDATE and DELETE
-- 3. SELECT policy (allow all reads for any role)
-- 4. Trigger function that raises on UPDATE or DELETE attempts
--    (defense-in-depth: fires even if RLS is somehow bypassed)

-- 1. Force RLS even for the table owner
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;

-- 2. Explicit policies — deny UPDATE and DELETE from ALL roles
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'audit_events' AND policyname = 'audit_deny_update'
  ) THEN
    CREATE POLICY audit_deny_update
      ON audit_events
      FOR UPDATE
      USING (false);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'audit_events' AND policyname = 'audit_deny_delete'
  ) THEN
    CREATE POLICY audit_deny_delete
      ON audit_events
      FOR DELETE
      USING (false);
  END IF;
END $$;

-- 3. SELECT policy — allow reads for audit search functionality
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'audit_events' AND policyname = 'audit_allow_select'
  ) THEN
    CREATE POLICY audit_allow_select
      ON audit_events
      FOR SELECT
      USING (true);
  END IF;
END $$;

-- 4. Trigger — defense-in-depth against UPDATE and DELETE
CREATE OR REPLACE FUNCTION audit_events_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % operations are forbidden',
    TG_OP
    USING ERRCODE = 'insufficient_privilege';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_events_no_update ON audit_events;
CREATE TRIGGER audit_events_no_update
  BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();

DROP TRIGGER IF EXISTS audit_events_no_delete ON audit_events;
CREATE TRIGGER audit_events_no_delete
  BEFORE DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();
