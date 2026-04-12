-- Audit event append-only enforcement
-- Applied as a migration so it survives every fresh deploy.

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'audit_events' AND policyname = 'audit_insert_only'
  ) THEN
    CREATE POLICY audit_insert_only
      ON audit_events
      FOR INSERT
      WITH CHECK (true);
  END IF;
END $$;

REVOKE UPDATE ON audit_events FROM sep;
REVOKE DELETE ON audit_events FROM sep;
