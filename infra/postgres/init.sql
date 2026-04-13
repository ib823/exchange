-- ════════════════════════════════════════════════════════════════
-- Postgres initialization — Malaysia Secure Exchange Platform
-- Run once on database creation.
-- Enforces append-only constraint on audit_events via RLS.
-- ════════════════════════════════════════════════════════════════

-- Create test database (for CI)
SELECT 'CREATE DATABASE sep_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'sep_test')\gexec

-- ─── Row-Level Security: Audit Events ─────────────────────────
-- After Prisma creates the audit_events table, apply RLS so that
-- no user (including the application user) can UPDATE or DELETE rows.
-- The application role (sep) may only INSERT and SELECT.

-- This is applied via a migration after table creation, not here,
-- because Prisma must create the table first.
-- See: packages/db/prisma/migrations/001_audit_rls.sql

-- ─── Extensions ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- ─── Roles ────────────────────────────────────────────────────
-- sep       = migration/owner role — used ONLY by prisma migrate commands
-- sep_app   = runtime application role — used by the running application
--
-- sep_app gets DML (SELECT, INSERT, UPDATE, DELETE) but NOT DDL
-- (CREATE, ALTER, DROP, TRUNCATE). This separation ensures:
-- 1. The application cannot alter its own schema at runtime
-- 2. RLS policies apply to sep_app (non-owner roles respect RLS)
-- 3. Audit append-only enforcement is structurally durable

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'sep_app') THEN
    CREATE ROLE sep_app LOGIN PASSWORD 'sep_app';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE sep_dev TO sep_app;
GRANT USAGE ON SCHEMA public TO sep_app;

-- Grant DML on all existing tables (new tables get grants via post-migration hook)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sep_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sep_app;

-- Default privileges: any table created by sep in public schema
-- automatically gets DML grants for sep_app
ALTER DEFAULT PRIVILEGES FOR ROLE sep IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sep_app;
ALTER DEFAULT PRIVILEGES FOR ROLE sep IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO sep_app;

-- Also set up for the test database
GRANT CONNECT ON DATABASE sep_test TO sep_app;

-- The sep user (Prisma) is the migration/owner identity only.
-- The running application connects as sep_app via RUNTIME_DATABASE_URL.
