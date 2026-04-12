-- CreateEnum
CREATE TYPE "ServiceTier" AS ENUM ('STANDARD', 'DEDICATED', 'PRIVATE');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('PLATFORM_SUPER_ADMIN', 'TENANT_ADMIN', 'SECURITY_ADMIN', 'INTEGRATION_ENGINEER', 'OPERATIONS_ANALYST', 'COMPLIANCE_REVIEWER');

-- CreateEnum
CREATE TYPE "PartnerType" AS ENUM ('BANK', 'REGULATOR', 'ENTERPRISE', 'ERP_SOURCE');

-- CreateEnum
CREATE TYPE "Environment" AS ENUM ('TEST', 'CERTIFICATION', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "PartnerProfileStatus" AS ENUM ('DRAFT', 'TEST_READY', 'TEST_APPROVED', 'PROD_PENDING_APPROVAL', 'PROD_ACTIVE', 'SUSPENDED', 'RETIRED');

-- CreateEnum
CREATE TYPE "TransportProtocol" AS ENUM ('SFTP', 'HTTPS', 'AS2');

-- CreateEnum
CREATE TYPE "MessageSecurityMode" AS ENUM ('NONE', 'ENCRYPT', 'SIGN', 'SIGN_ENCRYPT', 'VERIFY', 'DECRYPT', 'VERIFY_DECRYPT');

-- CreateEnum
CREATE TYPE "SubmissionDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('RECEIVED', 'VALIDATED', 'QUEUED', 'PROCESSING', 'SECURED', 'SENT', 'ACK_PENDING', 'ACK_RECEIVED', 'COMPLETED', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryResult" AS ENUM ('SUCCESS', 'TRANSPORT_FAILURE', 'PARTNER_REJECTION', 'CRYPTO_FAILURE', 'VALIDATION_FAILURE', 'TIMEOUT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "KeyUsage" AS ENUM ('ENCRYPT', 'DECRYPT', 'SIGN', 'VERIFY', 'WRAP', 'UNWRAP');

-- CreateEnum
CREATE TYPE "KeyBackendType" AS ENUM ('PLATFORM_VAULT', 'TENANT_VAULT', 'EXTERNAL_KMS', 'SOFTWARE_LOCAL');

-- CreateEnum
CREATE TYPE "KeyState" AS ENUM ('DRAFT', 'IMPORTED', 'VALIDATED', 'ACTIVE', 'ROTATING', 'EXPIRED', 'REVOKED', 'RETIRED');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('P1', 'P2', 'P3', 'P4');

-- CreateEnum
CREATE TYPE "IncidentState" AS ENUM ('OPEN', 'TRIAGED', 'IN_PROGRESS', 'WAITING_EXTERNAL', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'SYSTEM', 'SERVICE', 'SCHEDULER');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('TENANT_CREATED', 'TENANT_UPDATED', 'TENANT_SUSPENDED', 'USER_CREATED', 'USER_ROLE_ASSIGNED', 'USER_SUSPENDED', 'PARTNER_PROFILE_CREATED', 'PARTNER_PROFILE_STATUS_CHANGED', 'PARTNER_PROFILE_UPDATED', 'KEY_REFERENCE_CREATED', 'KEY_REFERENCE_ACTIVATED', 'KEY_REFERENCE_ROTATED', 'KEY_REFERENCE_REVOKED', 'KEY_REFERENCE_EXPIRED', 'SUBMISSION_RECEIVED', 'SUBMISSION_VALIDATED', 'SUBMISSION_QUEUED', 'SUBMISSION_CRYPTO_APPLIED', 'SUBMISSION_DELIVERY_ATTEMPTED', 'SUBMISSION_DELIVERED', 'SUBMISSION_ACK_RECEIVED', 'SUBMISSION_COMPLETED', 'SUBMISSION_FAILED', 'SUBMISSION_RETRIED', 'SUBMISSION_CANCELLED', 'INBOUND_RECEIVED', 'INBOUND_VERIFIED', 'INBOUND_DECRYPTED', 'INBOUND_CORRELATED', 'APPROVAL_REQUESTED', 'APPROVAL_GRANTED', 'APPROVAL_REJECTED', 'INCIDENT_CREATED', 'INCIDENT_TRIAGED', 'INCIDENT_RESOLVED', 'WEBHOOK_REGISTERED', 'WEBHOOK_DISPATCHED', 'WEBHOOK_FAILED', 'SOURCE_SYSTEM_CREATED', 'SOURCE_SYSTEM_UPDATED', 'EXCHANGE_PROFILE_CREATED', 'EXCHANGE_PROFILE_UPDATED', 'RETENTION_POLICY_CREATED', 'RETENTION_POLICY_UPDATED', 'BREAK_GLASS_ACCESS');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalEntityName" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "serviceTier" "ServiceTier" NOT NULL DEFAULT 'STANDARD',
    "defaultRegion" TEXT NOT NULL DEFAULT 'ap-southeast-1',
    "retentionPolicyId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "authSubject" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_assignments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "scope" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" TEXT,

    CONSTRAINT "role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_policies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "encryptedArtifactDays" INTEGER NOT NULL DEFAULT 90,
    "decryptedArtifactDays" INTEGER NOT NULL DEFAULT 0,
    "auditRetentionDays" INTEGER NOT NULL DEFAULT 2555,
    "operatorLogDays" INTEGER NOT NULL DEFAULT 365,
    "incidentHistoryDays" INTEGER NOT NULL DEFAULT 2555,
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retention_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_systems" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "apiKeyRef" TEXT,
    "allowedIps" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_systems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_profiles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "partnerType" "PartnerType" NOT NULL,
    "environment" "Environment" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "PartnerProfileStatus" NOT NULL DEFAULT 'DRAFT',
    "transportProtocol" "TransportProtocol" NOT NULL,
    "messageSecurityMode" "MessageSecurityMode" NOT NULL DEFAULT 'NONE',
    "payloadContractRef" TEXT,
    "retryPolicyRef" TEXT,
    "keyPolicyRef" TEXT,
    "config" JSONB NOT NULL,
    "notes" TEXT,
    "effectiveDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_profiles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sourceSystemId" TEXT,
    "partnerProfileId" TEXT NOT NULL,
    "fileTypes" TEXT[],
    "retryPolicyConfig" JSONB NOT NULL DEFAULT '{}',
    "direction" "SubmissionDirection" NOT NULL DEFAULT 'OUTBOUND',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exchange_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceSystemId" TEXT,
    "exchangeProfileId" TEXT,
    "partnerProfileId" TEXT NOT NULL,
    "direction" "SubmissionDirection" NOT NULL DEFAULT 'OUTBOUND',
    "correlationId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "payloadRef" TEXT,
    "normalizedHash" TEXT,
    "payloadSize" INTEGER,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'RECEIVED',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_attempts" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "result" "DeliveryResult",
    "normalizedErrorCode" TEXT,
    "connectorType" "TransportProtocol",
    "remoteReference" TEXT,
    "retryEligible" BOOLEAN NOT NULL DEFAULT false,
    "durationMs" INTEGER,
    "metadata" JSONB,

    CONSTRAINT "delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_receipts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partnerProfileId" TEXT NOT NULL,
    "submissionId" TEXT,
    "correlationId" TEXT NOT NULL,
    "rawPayloadRef" TEXT,
    "parsedStatus" TEXT,
    "parsedReference" TEXT,
    "verificationResult" TEXT,
    "decryptionResult" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "inbound_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "key_references" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partnerProfileId" TEXT,
    "name" TEXT NOT NULL,
    "usage" "KeyUsage"[],
    "backendType" "KeyBackendType" NOT NULL,
    "backendRef" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "state" "KeyState" NOT NULL DEFAULT 'DRAFT',
    "environment" "Environment" NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "rotationTargetId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "key_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" "Role",
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "result" TEXT NOT NULL,
    "correlationId" TEXT,
    "traceId" TEXT,
    "environment" "Environment",
    "eventTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "immutableHash" TEXT NOT NULL,
    "previousHash" TEXT,
    "metadata" JSONB,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "severity" "IncidentSeverity" NOT NULL,
    "state" "IncidentState" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "assignedTo" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolution" TEXT,
    "escalatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "partnerProfileId" TEXT,
    "initiatorId" TEXT NOT NULL,
    "approverId" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "notes" TEXT,
    "diffSnapshot" JSONB,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "secretRef" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastFiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_delivery_attempts" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "submissionId" TEXT,
    "eventType" TEXT NOT NULL,
    "statusCode" INTEGER,
    "success" BOOLEAN NOT NULL,
    "attemptNo" INTEGER NOT NULL DEFAULT 1,
    "errorMessage" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMs" INTEGER,

    CONSTRAINT "webhook_delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- CreateIndex
CREATE INDEX "users_tenantId_idx" ON "users"("tenantId");

-- CreateIndex
CREATE INDEX "users_authSubject_idx" ON "users"("authSubject");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");

-- CreateIndex
CREATE INDEX "role_assignments_tenantId_userId_idx" ON "role_assignments"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "role_assignments_tenantId_userId_role_key" ON "role_assignments"("tenantId", "userId", "role");

-- CreateIndex
CREATE INDEX "retention_policies_tenantId_idx" ON "retention_policies"("tenantId");

-- CreateIndex
CREATE INDEX "source_systems_tenantId_idx" ON "source_systems"("tenantId");

-- CreateIndex
CREATE INDEX "source_systems_tenantId_active_idx" ON "source_systems"("tenantId", "active");

-- CreateIndex
CREATE INDEX "partner_profiles_tenantId_idx" ON "partner_profiles"("tenantId");

-- CreateIndex
CREATE INDEX "partner_profiles_tenantId_status_idx" ON "partner_profiles"("tenantId", "status");

-- CreateIndex
CREATE INDEX "partner_profiles_tenantId_environment_idx" ON "partner_profiles"("tenantId", "environment");

-- CreateIndex
CREATE INDEX "exchange_profiles_tenantId_idx" ON "exchange_profiles"("tenantId");

-- CreateIndex
CREATE INDEX "exchange_profiles_tenantId_active_idx" ON "exchange_profiles"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_correlationId_key" ON "submissions"("correlationId");

-- CreateIndex
CREATE INDEX "submissions_tenantId_idx" ON "submissions"("tenantId");

-- CreateIndex
CREATE INDEX "submissions_tenantId_status_idx" ON "submissions"("tenantId", "status");

-- CreateIndex
CREATE INDEX "submissions_correlationId_idx" ON "submissions"("correlationId");

-- CreateIndex
CREATE INDEX "submissions_partnerProfileId_idx" ON "submissions"("partnerProfileId");

-- CreateIndex
CREATE INDEX "submissions_createdAt_idx" ON "submissions"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_tenantId_idempotencyKey_key" ON "submissions"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "delivery_attempts_submissionId_idx" ON "delivery_attempts"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_receipts_submissionId_key" ON "inbound_receipts"("submissionId");

-- CreateIndex
CREATE INDEX "inbound_receipts_tenantId_idx" ON "inbound_receipts"("tenantId");

-- CreateIndex
CREATE INDEX "inbound_receipts_correlationId_idx" ON "inbound_receipts"("correlationId");

-- CreateIndex
CREATE INDEX "key_references_tenantId_idx" ON "key_references"("tenantId");

-- CreateIndex
CREATE INDEX "key_references_tenantId_state_idx" ON "key_references"("tenantId", "state");

-- CreateIndex
CREATE INDEX "key_references_expiresAt_idx" ON "key_references"("expiresAt");

-- CreateIndex
CREATE INDEX "audit_events_tenantId_eventTime_idx" ON "audit_events"("tenantId", "eventTime");

-- CreateIndex
CREATE INDEX "audit_events_tenantId_action_idx" ON "audit_events"("tenantId", "action");

-- CreateIndex
CREATE INDEX "audit_events_correlationId_idx" ON "audit_events"("correlationId");

-- CreateIndex
CREATE INDEX "audit_events_objectType_objectId_idx" ON "audit_events"("objectType", "objectId");

-- CreateIndex
CREATE INDEX "incidents_tenantId_idx" ON "incidents"("tenantId");

-- CreateIndex
CREATE INDEX "incidents_tenantId_state_idx" ON "incidents"("tenantId", "state");

-- CreateIndex
CREATE INDEX "incidents_tenantId_severity_idx" ON "incidents"("tenantId", "severity");

-- CreateIndex
CREATE INDEX "approvals_tenantId_idx" ON "approvals"("tenantId");

-- CreateIndex
CREATE INDEX "approvals_tenantId_status_idx" ON "approvals"("tenantId", "status");

-- CreateIndex
CREATE INDEX "approvals_expiresAt_idx" ON "approvals"("expiresAt");

-- CreateIndex
CREATE INDEX "webhooks_tenantId_idx" ON "webhooks"("tenantId");

-- CreateIndex
CREATE INDEX "webhook_delivery_attempts_webhookId_idx" ON "webhook_delivery_attempts"("webhookId");

-- CreateIndex
CREATE INDEX "webhook_delivery_attempts_submissionId_idx" ON "webhook_delivery_attempts"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "api_keys_tenantId_idx" ON "api_keys"("tenantId");

-- CreateIndex
CREATE INDEX "api_keys_prefix_idx" ON "api_keys"("prefix");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_systems" ADD CONSTRAINT "source_systems_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_profiles" ADD CONSTRAINT "partner_profiles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_profiles" ADD CONSTRAINT "exchange_profiles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_profiles" ADD CONSTRAINT "exchange_profiles_partnerProfileId_fkey" FOREIGN KEY ("partnerProfileId") REFERENCES "partner_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_profiles" ADD CONSTRAINT "exchange_profiles_sourceSystemId_fkey" FOREIGN KEY ("sourceSystemId") REFERENCES "source_systems"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_partnerProfileId_fkey" FOREIGN KEY ("partnerProfileId") REFERENCES "partner_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_sourceSystemId_fkey" FOREIGN KEY ("sourceSystemId") REFERENCES "source_systems"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_exchangeProfileId_fkey" FOREIGN KEY ("exchangeProfileId") REFERENCES "exchange_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_receipts" ADD CONSTRAINT "inbound_receipts_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_references" ADD CONSTRAINT "key_references_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_references" ADD CONSTRAINT "key_references_partnerProfileId_fkey" FOREIGN KEY ("partnerProfileId") REFERENCES "partner_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_initiatorId_fkey" FOREIGN KEY ("initiatorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_partnerProfileId_fkey" FOREIGN KEY ("partnerProfileId") REFERENCES "partner_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_delivery_attempts" ADD CONSTRAINT "webhook_delivery_attempts_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "webhooks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
