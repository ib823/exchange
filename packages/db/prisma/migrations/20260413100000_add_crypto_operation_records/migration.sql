-- CryptoOperationRecord table — immutable audit trail for all crypto operations
-- M2: Step 3 — persistence for ICryptoService operation results

-- Enum types for crypto operations
CREATE TYPE "CryptoOperationType" AS ENUM (
  'SIGN', 'ENCRYPT', 'DECRYPT', 'VERIFY', 'SIGN_AND_ENCRYPT', 'VERIFY_AND_DECRYPT'
);

CREATE TYPE "CryptoOperationResult" AS ENUM (
  'SUCCESS', 'FAILURE', 'POLICY_VIOLATION'
);

CREATE TABLE "crypto_operation_records" (
  "id"                TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "tenantId"          TEXT NOT NULL,
  "submissionId"      TEXT,
  "keyReferenceId"    TEXT NOT NULL,
  "operationType"     "CryptoOperationType" NOT NULL,
  "result"            "CryptoOperationResult" NOT NULL,
  "algorithmPolicy"   JSONB NOT NULL,
  "keyFingerprint"    TEXT NOT NULL,
  "performedAt"       TIMESTAMPTZ NOT NULL,
  "errorCode"         TEXT,
  "correlationId"     TEXT,
  "actorId"           TEXT NOT NULL,
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "crypto_operation_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crypto_operation_records_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT,
  CONSTRAINT "crypto_operation_records_keyReferenceId_fkey"
    FOREIGN KEY ("keyReferenceId") REFERENCES "key_references"("id") ON DELETE RESTRICT
);

-- Indexes for forensic queries
CREATE INDEX "crypto_operation_records_tenant_correlation_performed"
  ON "crypto_operation_records" ("tenantId", "correlationId", "performedAt");

CREATE INDEX "crypto_operation_records_key_performed"
  ON "crypto_operation_records" ("keyReferenceId", "performedAt");

-- Immutability: FORCE ROW LEVEL SECURITY (same pattern as audit_events)
ALTER TABLE "crypto_operation_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crypto_operation_records" FORCE ROW LEVEL SECURITY;

-- Deny UPDATE and DELETE for all roles
CREATE POLICY "crypto_operation_records_deny_update" ON "crypto_operation_records"
  FOR UPDATE USING (false);

CREATE POLICY "crypto_operation_records_deny_delete" ON "crypto_operation_records"
  FOR DELETE USING (false);

-- Allow INSERT and SELECT for the application role
CREATE POLICY "crypto_operation_records_allow_insert" ON "crypto_operation_records"
  FOR INSERT WITH CHECK (true);

CREATE POLICY "crypto_operation_records_allow_select" ON "crypto_operation_records"
  FOR SELECT USING (true);

-- Defense-in-depth: trigger to block UPDATE/DELETE even if RLS is bypassed
CREATE OR REPLACE FUNCTION deny_crypto_record_modification()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'crypto_operation_records is immutable — UPDATE and DELETE are forbidden';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER crypto_operation_records_no_update
  BEFORE UPDATE ON "crypto_operation_records"
  FOR EACH ROW EXECUTE FUNCTION deny_crypto_record_modification();

CREATE TRIGGER crypto_operation_records_no_delete
  BEFORE DELETE ON "crypto_operation_records"
  FOR EACH ROW EXECUTE FUNCTION deny_crypto_record_modification();

-- Grant DML to sep_app (idempotent, same pattern as grant_sep_app_dml migration)
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'sep_app') THEN
    GRANT SELECT, INSERT ON "crypto_operation_records" TO sep_app;
  END IF;
END
$$;
