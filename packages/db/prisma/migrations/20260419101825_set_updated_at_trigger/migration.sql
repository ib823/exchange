-- M3.A3-T01 + M3.A3-T02 — DB-authored `updatedAt` via trigger.
--
-- Closes R2-003 (HIGH): app-layer timestamp writes cannot be trusted as
-- the authoritative mutation record because (a) client clocks drift,
-- (b) a compromised or buggy service could backdate a record, and
-- (c) Prisma's `@updatedAt` sets the value in the outgoing UPDATE
-- statement — i.e. the app owns the value, not the DB. This migration
-- moves ownership to the DB: a BEFORE UPDATE trigger rewrites
-- `"updatedAt"` to `now()` on every UPDATE regardless of what the
-- client sent. Prisma's own `@updatedAt` still populates on INSERT
-- (via the Prisma runtime) and on UPDATE (via the same runtime) — the
-- trigger then overwrites the UPDATE value. Net: the DB always wins on
-- UPDATE.
--
-- Column name: Prisma-generated tables use quoted camelCase
-- `"updatedAt"` (see 20260412061509_init). The trigger function
-- references that literal column — renaming the Prisma field would
-- require a matching migration update.
--
-- Tables attached (10, from plan §5-T02):
--   tenants, users, retention_policies, source_systems,
--   partner_profiles, exchange_profiles, submissions,
--   key_references, incidents, webhooks
--
-- Deliberately NOT attached:
--   audit_events              — append-only, BEFORE UPDATE trigger
--                               already raises 'audit_events is
--                               append-only' (20260412140000)
--   crypto_operation_records  — immutable by design (no updatedAt)
--   api_keys                  — uses explicit `revokedAt`/`lastUsedAt`
--   role_assignments          — append-only (no updatedAt)
--   delivery_attempts         — domain-specific timestamps
--   webhook_delivery_attempts — domain-specific timestamps
--   inbound_receipts          — domain-specific timestamps
--   approvals                 — domain-specific timestamps
--   refresh_tokens            — uses `revokedAt` + `replacedById`
--
-- Idempotency: CREATE OR REPLACE FUNCTION is re-runnable. Triggers are
-- not, so each attachment is preceded by DROP TRIGGER IF EXISTS —
-- matches the house pattern from M3.A1 migrations. Re-running this
-- migration against an already-migrated DB is a no-op.
--
-- Security mapping: A08:2021 Software and Data Integrity Failures;
-- CWE-353 Missing Support for Integrity Check.

-- ── Function ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION set_updated_at() IS
  'M3.A3-T01: BEFORE UPDATE trigger function. Overwrites NEW."updatedAt" with server clock. Attached to 10 mutable tables; see 20260419101825_set_updated_at_trigger.';

-- ── Attachments ───────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS set_updated_at_tenants ON tenants;
CREATE TRIGGER set_updated_at_tenants
BEFORE UPDATE ON tenants
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_users ON users;
CREATE TRIGGER set_updated_at_users
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_retention_policies ON retention_policies;
CREATE TRIGGER set_updated_at_retention_policies
BEFORE UPDATE ON retention_policies
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_source_systems ON source_systems;
CREATE TRIGGER set_updated_at_source_systems
BEFORE UPDATE ON source_systems
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_partner_profiles ON partner_profiles;
CREATE TRIGGER set_updated_at_partner_profiles
BEFORE UPDATE ON partner_profiles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_exchange_profiles ON exchange_profiles;
CREATE TRIGGER set_updated_at_exchange_profiles
BEFORE UPDATE ON exchange_profiles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_submissions ON submissions;
CREATE TRIGGER set_updated_at_submissions
BEFORE UPDATE ON submissions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_key_references ON key_references;
CREATE TRIGGER set_updated_at_key_references
BEFORE UPDATE ON key_references
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_incidents ON incidents;
CREATE TRIGGER set_updated_at_incidents
BEFORE UPDATE ON incidents
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_webhooks ON webhooks;
CREATE TRIGGER set_updated_at_webhooks
BEFORE UPDATE ON webhooks
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
