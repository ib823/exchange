-- M3.A1-T02: Denormalize tenantId onto FK-scoped tables
--
-- Adds tenantId column to delivery_attempts and webhook_delivery_attempts,
-- backfills from the parent FK (submissions for delivery, webhooks for
-- webhook delivery), then enforces NOT NULL and adds FK + index. The NOT
-- NULL is deferred until after backfill so the migration is safe against
-- non-empty tables. Prisma's default wraps migration SQL in BEGIN/COMMIT,
-- giving the whole operation atomic-or-rollback semantics.
--
-- Scope: PRIOR-R2-001 + PRIOR-R3-001 (M3.A1 RLS single-column-predicate
-- precondition). The RLS policies themselves land in M3.A1-T04.

-- delivery_attempts.tenantId ─────────────────────────────────────────────
ALTER TABLE "delivery_attempts" ADD COLUMN "tenantId" TEXT;

UPDATE "delivery_attempts" da
SET "tenantId" = s."tenantId"
FROM "submissions" s
WHERE da."submissionId" = s."id";

ALTER TABLE "delivery_attempts" ALTER COLUMN "tenantId" SET NOT NULL;

ALTER TABLE "delivery_attempts"
ADD CONSTRAINT "delivery_attempts_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "delivery_attempts_tenantId_idx" ON "delivery_attempts"("tenantId");

-- webhook_delivery_attempts.tenantId ─────────────────────────────────────
-- webhook_delivery_attempts.webhookId is NOT NULL in the current schema,
-- so we backfill exclusively from webhooks.tenantId. Plan §5 mentions a
-- submissions fallback for webhookId-null rows, but the schema does not
-- permit null webhookId; that fallback is unreachable in the real data.
ALTER TABLE "webhook_delivery_attempts" ADD COLUMN "tenantId" TEXT;

UPDATE "webhook_delivery_attempts" wda
SET "tenantId" = w."tenantId"
FROM "webhooks" w
WHERE wda."webhookId" = w."id";

ALTER TABLE "webhook_delivery_attempts" ALTER COLUMN "tenantId" SET NOT NULL;

ALTER TABLE "webhook_delivery_attempts"
ADD CONSTRAINT "webhook_delivery_attempts_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "webhook_delivery_attempts_tenantId_idx" ON "webhook_delivery_attempts"("tenantId");
