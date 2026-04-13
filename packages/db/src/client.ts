import { PrismaClient } from '@prisma/client';

/**
 * Prisma client singleton.
 *
 * Rules:
 * - Always use this singleton — never instantiate PrismaClient directly
 * - In tests, use the test DATABASE_URL (sep_test database)
 * - Never log query parameters — they may contain identifiers
 * - The client is NOT exported directly — use getPrismaClient()
 */

declare global {
  // Prevent multiple instances in development hot-reload
  // eslint-disable-next-line no-var
  var __sepPrismaClient: PrismaClient | undefined;
}

function createClient(): PrismaClient {
  return new PrismaClient({
    log: [
      { level: 'warn', emit: 'event' },
      { level: 'error', emit: 'event' },
      // Deliberately NOT logging 'query' — parameters may contain tenant data
    ],
    errorFormat: 'minimal',
  });
}

export function getPrismaClient(): PrismaClient {
  if (global.__sepPrismaClient === undefined) {
    global.__sepPrismaClient = createClient();
  }
  return global.__sepPrismaClient;
}

export async function disconnectPrisma(): Promise<void> {
  if (global.__sepPrismaClient !== undefined) {
    await global.__sepPrismaClient.$disconnect();
    global.__sepPrismaClient = undefined;
  }
}

// Re-export Prisma types for consumers
export { Prisma } from '@prisma/client';
export type {
  Tenant,
  User,
  RoleAssignment,
  PartnerProfile,
  Submission,
  DeliveryAttempt,
  InboundReceipt,
  KeyReference,
  AuditEvent,
  Incident,
  Approval,
  Webhook,
  ApiKey,
  RetentionPolicy,
  ExchangeProfile,
  SourceSystem,
  WebhookDeliveryAttempt,
  CryptoOperationRecord,
} from '@prisma/client';

export {
  Role,
  Environment,
  PartnerType,
  PartnerProfileStatus,
  TransportProtocol,
  MessageSecurityMode,
  SubmissionStatus,
  SubmissionDirection,
  DeliveryResult,
  KeyUsage,
  KeyBackendType,
  KeyState,
  IncidentSeverity,
  IncidentState,
  ApprovalStatus,
  ActorType,
  AuditAction,
  ServiceTier,
  UserStatus,
  CryptoOperationType,
  CryptoOperationResult,
} from '@prisma/client';
