import { z } from 'zod';

export const EnvironmentSchema = z.enum(['TEST', 'CERTIFICATION', 'PRODUCTION']);
export const RoleSchema = z.enum([
  'PLATFORM_SUPER_ADMIN','TENANT_ADMIN','SECURITY_ADMIN',
  'INTEGRATION_ENGINEER','OPERATIONS_ANALYST','COMPLIANCE_REVIEWER',
]);
export const PartnerTypeSchema = z.enum(['BANK','REGULATOR','ENTERPRISE','ERP_SOURCE']);
export const TransportProtocolSchema = z.enum(['SFTP','HTTPS','AS2']);
export const MessageSecurityModeSchema = z.enum([
  'NONE','ENCRYPT','SIGN','SIGN_ENCRYPT','VERIFY','DECRYPT','VERIFY_DECRYPT',
]);
export const SubmissionStatusSchema = z.enum([
  'RECEIVED','VALIDATED','QUEUED','PROCESSING','SECURED','SENT',
  'ACK_PENDING','ACK_RECEIVED','COMPLETED','FAILED_RETRYABLE','FAILED_FINAL','CANCELLED',
]);
export const KeyStateSchema = z.enum([
  'DRAFT','IMPORTED','VALIDATED','ACTIVE','ROTATING','EXPIRED','REVOKED','RETIRED',
  'SUSPENDED','COMPROMISED','DESTROYED',
]);
export const PartnerProfileStatusSchema = z.enum([
  'DRAFT','TEST_READY','TEST_APPROVED','PROD_PENDING_APPROVAL',
  'PROD_ACTIVE','SUSPENDED','RETIRED',
]);
export const ServiceTierSchema = z.enum(['STANDARD','DEDICATED','PRIVATE']);

export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const CuidSchema = z.string().cuid();
export const CorrelationIdSchema = z.string().uuid().or(z.string().cuid());
export const IdempotencyKeySchema = z.string().min(1).max(255);
export const TenantIdParamSchema = z.object({ tenantId: CuidSchema });
