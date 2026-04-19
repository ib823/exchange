-- M3.A1-T03: RefreshToken model + RLS policies (consistency-by-construction)
--
-- Creates refresh_tokens for M3.A4 auth-lifecycle consumption. The table
-- includes tenantId denormalized from creation, and its RLS policies are
-- defined in this same migration so the table never exists without RLS.
--
-- Policy predicate uses NULLIF(current_setting(...), '')-based comparison
-- against a cuid-shaped tenant id, per plan §2.1 as corrected in
-- _plan/M3_A1_EXECUTION_PROMPT.md §3. Do NOT use ::uuid cast — Tenant.id
-- is @default(cuid()), not UUID.
--
-- Prisma migrate deploy wraps this migration in BEGIN/COMMIT by default,
-- so CREATE TABLE + ENABLE RLS + CREATE POLICY are atomic.

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "replacedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revocationReason" TEXT,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");
CREATE INDEX "refresh_tokens_tenantId_idx" ON "refresh_tokens"("tenantId");
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");
CREATE INDEX "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt");

-- AddForeignKey
ALTER TABLE "refresh_tokens"
ADD CONSTRAINT "refresh_tokens_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "refresh_tokens"
ADD CONSTRAINT "refresh_tokens_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-Level Security — enabled + forced from creation
ALTER TABLE "refresh_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refresh_tokens" FORCE ROW LEVEL SECURITY;

-- Policies — tenant-scoped, fail-closed on missing session variable
CREATE POLICY "refresh_tokens_tenant_select" ON "refresh_tokens"
  FOR SELECT
  USING ("tenantId" = NULLIF(current_setting('app.current_tenant_id', true), ''));

CREATE POLICY "refresh_tokens_tenant_insert" ON "refresh_tokens"
  FOR INSERT
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.current_tenant_id', true), ''));

CREATE POLICY "refresh_tokens_tenant_update" ON "refresh_tokens"
  FOR UPDATE
  USING ("tenantId" = NULLIF(current_setting('app.current_tenant_id', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.current_tenant_id', true), ''));

CREATE POLICY "refresh_tokens_tenant_delete" ON "refresh_tokens"
  FOR DELETE
  USING ("tenantId" = NULLIF(current_setting('app.current_tenant_id', true), ''));
