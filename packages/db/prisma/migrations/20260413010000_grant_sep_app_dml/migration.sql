-- ════════════════════════════════════════════════════════════════
-- Grant sep_app runtime role DML privileges on all tables
-- sep_app is the application runtime identity (non-owner).
-- It gets SELECT, INSERT, UPDATE, DELETE but NOT CREATE, ALTER, DROP.
-- This separation is required for RLS enforcement (M3) and
-- prevents the application from altering its own schema.
-- ════════════════════════════════════════════════════════════════

-- Create role if it doesn't exist (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'sep_app') THEN
    CREATE ROLE sep_app LOGIN PASSWORD 'sep_app';
  END IF;
END
$$;

-- Grant schema usage
GRANT USAGE ON SCHEMA public TO sep_app;

-- Grant DML on all existing tables
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sep_app;

-- Grant sequence usage (for auto-increment / serial columns)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sep_app;

-- Set default privileges so future tables created by sep also grant to sep_app
ALTER DEFAULT PRIVILEGES FOR ROLE sep IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sep_app;
ALTER DEFAULT PRIVILEGES FOR ROLE sep IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO sep_app;
