-- ════════════════════════════════════════════════════════════════
-- M3.A4-T01: Auth lifecycle fields + recovery_codes table
-- ════════════════════════════════════════════════════════════════
--
-- Adds six columns to `users` for password-based login + MFA +
-- lockout, and creates the `recovery_codes` table with RLS wired to
-- the same tenant-scoping invariant as the other M3.A1 tables.
--
-- All column additions are additive: existing rows get sensible
-- defaults (NULL for the three DateTime/TEXT fields, 0 for the
-- counter). No data migration needed.
--
-- Column-by-column rationale:
--
--   passwordHash         argon2id hash. NULL until the user sets a
--                        password. Invite-flow users may never have
--                        one if they sign in only via API key.
--   mfaSecretRef         Vault KV-v2 path where the TOTP secret lives,
--                        NOT the secret itself. Format:
--                        `platform/mfa-secrets/<userId>`. Dropping the
--                        column never leaks material — it's just a
--                        pointer.
--   mfaEnrolledAt        set when the user confirms enrollment via a
--                        valid TOTP code. Distinct from mfaSecretRef
--                        being non-null: a user who started enrolling
--                        but never confirmed has a ref but no enrolled
--                        timestamp, and MFA is NOT yet required.
--   failedLoginAttempts  counter for the 10/30/30 lockout policy.
--                        Reset to 0 on successful login. Not reset by
--                        passage of time alone — the 30-min window
--                        check uses lastFailedAt.
--   lastFailedAt         anchors the 30-min sliding window. A failed
--                        attempt >30 min after the last failure
--                        restarts the counter at 1.
--   lockedUntil          set atomically in the lockout UPDATE when
--                        failedLoginAttempts crosses 10 within the
--                        window. Any login attempt before this
--                        timestamp is refused (the atomic UPDATE
--                        leaves the counter where it is — no further
--                        escalation from a locked account).
--
-- The RLS block at the bottom follows the M3.A1-T04 pattern exactly:
-- ENABLE + FORCE + 4 tenant policies (SELECT, INSERT, UPDATE with
-- both USING and WITH CHECK per gotcha #7, DELETE).
-- ════════════════════════════════════════════════════════════════

-- AlterTable: users
ALTER TABLE "users"
  ADD COLUMN "passwordHash"        TEXT,
  ADD COLUMN "mfaSecretRef"        TEXT,
  ADD COLUMN "mfaEnrolledAt"       TIMESTAMP(3),
  ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastFailedAt"        TIMESTAMP(3),
  ADD COLUMN "lockedUntil"         TIMESTAMP(3);

-- CreateTable: recovery_codes
CREATE TABLE "recovery_codes" (
    "id"        TEXT NOT NULL,
    "tenantId"  TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "codeHash"  TEXT NOT NULL,
    "usedAt"    TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recovery_codes_tenantId_idx" ON "recovery_codes"("tenantId");
CREATE INDEX "recovery_codes_userId_idx"   ON "recovery_codes"("userId");

-- AddForeignKey
ALTER TABLE "recovery_codes"
  ADD CONSTRAINT "recovery_codes_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "recovery_codes"
  ADD CONSTRAINT "recovery_codes_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── RLS on recovery_codes ───────────────────────────────────────
-- Mirrors the M3.A1-T04 pattern for the 17 existing tenant-scoped
-- tables. ENABLE + FORCE so the table owner (sep) is not exempt.
-- Policy predicate uses NULLIF(current_setting('app.current_tenant_id',
-- true), '') to match Tenant.id's cuid shape (not UUID).

ALTER TABLE "recovery_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recovery_codes" FORCE  ROW LEVEL SECURITY;

CREATE POLICY "recovery_codes_tenant_select" ON "recovery_codes"
  FOR SELECT
  USING ("tenantId" = NULLIF(current_setting('app.current_tenant_id', true), ''));

CREATE POLICY "recovery_codes_tenant_insert" ON "recovery_codes"
  FOR INSERT
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.current_tenant_id', true), ''));

-- UPDATE needs BOTH USING and WITH CHECK (M3.A1-T04 gotcha #7) — without
-- WITH CHECK, a row could be updated to move it from tenant A to tenant B.
CREATE POLICY "recovery_codes_tenant_update" ON "recovery_codes"
  FOR UPDATE
  USING      ("tenantId" = NULLIF(current_setting('app.current_tenant_id', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.current_tenant_id', true), ''));

CREATE POLICY "recovery_codes_tenant_delete" ON "recovery_codes"
  FOR DELETE
  USING ("tenantId" = NULLIF(current_setting('app.current_tenant_id', true), ''));

-- sep_app DML grants: the ALTER DEFAULT PRIVILEGES from
-- 20260413010000_grant_sep_app_dml already covers future tables
-- created by role `sep`, so recovery_codes auto-inherits
-- SELECT/INSERT/UPDATE/DELETE for sep_app. No explicit GRANT needed.
