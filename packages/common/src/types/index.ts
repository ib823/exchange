// ── Branded primitives ────────────────────────────────────────────────────────
declare const __brand: unique symbol;
type Brand<T, B> = T & { [__brand]: B };

export type TenantId = Brand<string, 'TenantId'>;
export type UserId = Brand<string, 'UserId'>;
export type SubmissionId = Brand<string, 'SubmissionId'>;
export type CorrelationId = Brand<string, 'CorrelationId'>;
export type KeyReferenceId = Brand<string, 'KeyReferenceId'>;
export type PartnerProfileId = Brand<string, 'PartnerProfileId'>;
export type IncidentId = Brand<string, 'IncidentId'>;
export type ApprovalId = Brand<string, 'ApprovalId'>;

export function asTenantId(s: string): TenantId {
  return s as TenantId;
}
export function asUserId(s: string): UserId {
  return s as UserId;
}
export function asSubmissionId(s: string): SubmissionId {
  return s as SubmissionId;
}
export function asCorrelationId(s: string): CorrelationId {
  return s as CorrelationId;
}
export function asKeyReferenceId(s: string): KeyReferenceId {
  return s as KeyReferenceId;
}
export function asPartnerProfileId(s: string): PartnerProfileId {
  return s as PartnerProfileId;
}

// ── Pagination ────────────────────────────────────────────────────────────────
export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

// ── API response shapes ────────────────────────────────────────────────────────
export interface ApiSuccess<T> {
  data: T;
  meta?: {
    correlationId?: string;
    page?: number;
    total?: number;
  };
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    terminal: boolean;
    correlationId?: string;
  };
}

// ── Audit actor ────────────────────────────────────────────────────────────────
export interface AuditActor {
  actorType: 'USER' | 'SYSTEM' | 'SERVICE' | 'SCHEDULER';
  actorId: string;
  tenantId: string;
  role?: string;
}

// ── Request context ────────────────────────────────────────────────────────────
export interface RequestContext {
  correlationId: CorrelationId;
  traceId?: string;
  tenantId: TenantId;
  actor: AuditActor;
  requestedAt: Date;
}

// ── Platform enums (mirroring Prisma enums without Prisma dependency) ──────────
export const Role = {
  PLATFORM_SUPER_ADMIN: 'PLATFORM_SUPER_ADMIN',
  TENANT_ADMIN: 'TENANT_ADMIN',
  SECURITY_ADMIN: 'SECURITY_ADMIN',
  INTEGRATION_ENGINEER: 'INTEGRATION_ENGINEER',
  OPERATIONS_ANALYST: 'OPERATIONS_ANALYST',
  COMPLIANCE_REVIEWER: 'COMPLIANCE_REVIEWER',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const Environment = {
  TEST: 'TEST',
  CERTIFICATION: 'CERTIFICATION',
  PRODUCTION: 'PRODUCTION',
} as const;
export type Environment = (typeof Environment)[keyof typeof Environment];

export const SubmissionStatus = {
  RECEIVED: 'RECEIVED',
  VALIDATED: 'VALIDATED',
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  SECURED: 'SECURED',
  SENT: 'SENT',
  ACK_PENDING: 'ACK_PENDING',
  ACK_RECEIVED: 'ACK_RECEIVED',
  COMPLETED: 'COMPLETED',
  FAILED_RETRYABLE: 'FAILED_RETRYABLE',
  FAILED_FINAL: 'FAILED_FINAL',
  CANCELLED: 'CANCELLED',
} as const;
export type SubmissionStatus = (typeof SubmissionStatus)[keyof typeof SubmissionStatus];

export const TERMINAL_SUBMISSION_STATUSES = new Set<SubmissionStatus>([
  SubmissionStatus.COMPLETED,
  SubmissionStatus.FAILED_FINAL,
  SubmissionStatus.CANCELLED,
]);

export const KeyState = {
  DRAFT: 'DRAFT',
  IMPORTED: 'IMPORTED',
  VALIDATED: 'VALIDATED',
  ACTIVE: 'ACTIVE',
  ROTATING: 'ROTATING',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
  RETIRED: 'RETIRED',
  SUSPENDED: 'SUSPENDED',
  COMPROMISED: 'COMPROMISED',
  DESTROYED: 'DESTROYED',
} as const;
export type KeyState = (typeof KeyState)[keyof typeof KeyState];

export const PartnerProfileStatus = {
  DRAFT: 'DRAFT',
  TEST_READY: 'TEST_READY',
  TEST_APPROVED: 'TEST_APPROVED',
  PROD_PENDING_APPROVAL: 'PROD_PENDING_APPROVAL',
  PROD_ACTIVE: 'PROD_ACTIVE',
  SUSPENDED: 'SUSPENDED',
  RETIRED: 'RETIRED',
} as const;
export type PartnerProfileStatus = (typeof PartnerProfileStatus)[keyof typeof PartnerProfileStatus];

// ── Actor context — propagated through every async boundary ───────────────────
export interface ActorContext {
  readonly actorId: string;
  readonly actorRole: string;
  readonly credentialId?: string | undefined;
}

// ── Queue job contracts ────────────────────────────────────────────────────────
// Payload content is NEVER in the job — only storage references
export interface SubmissionJob {
  readonly jobId: string;
  readonly correlationId: CorrelationId;
  readonly tenantId: TenantId;
  readonly submissionId: SubmissionId;
  readonly partnerProfileId: PartnerProfileId;
  readonly payloadRef: string; // Object storage key — not the content
  readonly normalizedHash: string; // SHA-256 of payload
  readonly attempt: number;
  readonly enqueuedAt: string; // ISO 8601
  readonly actorId: string; // Originating actor — preserved through retries
  readonly actorRole: string;
  readonly credentialId?: string | undefined;
  readonly sourceSystemId?: string | undefined;
  readonly exchangeProfileId?: string | undefined;
}

export interface CryptoJob extends SubmissionJob {
  readonly operation: 'ENCRYPT' | 'SIGN' | 'SIGN_ENCRYPT' | 'DECRYPT' | 'VERIFY' | 'VERIFY_DECRYPT';
  readonly keyReferenceId: KeyReferenceId;
}

export interface DeliveryJob extends SubmissionJob {
  readonly securedPayloadRef: string; // Object storage key of the secured payload
  readonly connectorType: 'SFTP' | 'HTTPS' | 'AS2';
}

export interface InboundJob {
  readonly jobId: string;
  readonly correlationId: CorrelationId;
  readonly tenantId: TenantId;
  readonly partnerProfileId: PartnerProfileId;
  readonly rawPayloadRef: string;
  readonly receivedAt: string;
  readonly actorId: string;
  readonly actorRole: string;
  readonly credentialId?: string;
}

// ── Nonce / replay prevention ─────────────────────────────────────────────────
export interface NonceRecord {
  nonce: string;
  tenantId: TenantId;
  usedAt: Date;
  expiresAt: Date;
}

// Timestamp window for replay rejection: requests older than this are rejected
export const REQUEST_TIMESTAMP_WINDOW_SECONDS = 300; // 5 minutes
