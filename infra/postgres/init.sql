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
-- Application role: READ + INSERT only (no UPDATE/DELETE on audit)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'sep_app') THEN
    CREATE ROLE sep_app;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE sep_dev TO sep_app;
GRANT USAGE ON SCHEMA public TO sep_app;

-- The sep user (Prisma) gets full access for migrations.
-- In production, restrict to sep_app role for runtime.
