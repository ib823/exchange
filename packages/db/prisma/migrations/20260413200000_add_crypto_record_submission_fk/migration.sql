-- Add FOREIGN KEY constraint on crypto_operation_records.submissionId → submissions.id
-- ON DELETE RESTRICT: forensic evidence must be preserved even if a submission
-- is scheduled for deletion. The crypto operation record is the primary evidence
-- that a specific payload was signed or encrypted with a specific key.
-- Deleting the submission must not silently delete the cryptographic evidence.

ALTER TABLE "crypto_operation_records"
  ADD CONSTRAINT "crypto_operation_records_submissionId_fkey"
  FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE RESTRICT;

-- Index for FK lookup performance (Postgres does not auto-index FK columns)
CREATE INDEX IF NOT EXISTS "crypto_operation_records_submissionId"
  ON "crypto_operation_records" ("submissionId")
  WHERE "submissionId" IS NOT NULL;
