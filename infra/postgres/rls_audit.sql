-- Append-only enforcement for audit_events table.
-- Run once after prisma migrate creates the table.
-- Prevents any UPDATE or DELETE on audit records — even by the application user.

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

-- Allow inserts from the application role
CREATE POLICY audit_insert_only
  ON audit_events
  FOR INSERT
  WITH CHECK (true);

-- Revoke UPDATE and DELETE from the application user
-- These will fail silently unless RLS is bypassed (requires superuser)
REVOKE UPDATE ON audit_events FROM sep;
REVOKE DELETE ON audit_events FROM sep;

-- Verify
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'audit_events' AND policyname = 'audit_insert_only'
  ) THEN
    RAISE EXCEPTION 'RLS policy not applied to audit_events';
  END IF;
  RAISE NOTICE 'audit_events RLS verified OK';
END;
$$;
