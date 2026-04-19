/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  DeliveryJob,
  CorrelationId,
  TenantId,
  SubmissionId,
  PartnerProfileId,
} from '@sep/common';

vi.mock('@sep/observability', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  deliveryCounter: { inc: vi.fn() },
  deliveryRetryCounter: { inc: vi.fn() },
}));

vi.mock('@sep/common', async () => {
  const actual = await vi.importActual<typeof import('@sep/common')>('@sep/common');
  return {
    ...actual,
    getConfig: () => ({
      audit: { hashSecret: 'test-hash-secret-minimum-32-characters' },
      redis: { queue: { defaultMaxAttempts: 3, defaultBackoffDelayMs: 5000 } },
    }),
  };
});

const mockDeliveryAttemptFindFirst = vi.fn();
const mockDeliveryAttemptCreate = vi.fn();
const mockDeliveryAttemptUpdate = vi.fn();
const mockSubmissionUpdate = vi.fn();
const mockProfileFindFirst = vi.fn();
const mockAuditCreate = vi.fn();
const mockDb = {
  deliveryAttempt: {
    findFirst: mockDeliveryAttemptFindFirst,
    create: mockDeliveryAttemptCreate,
    update: mockDeliveryAttemptUpdate,
  },
  submission: { update: mockSubmissionUpdate },
  partnerProfile: { findFirst: mockProfileFindFirst },
  auditEvent: { findFirst: vi.fn().mockResolvedValue(null), create: mockAuditCreate },
};

vi.mock('@sep/db', () => ({
  DatabaseService: vi.fn().mockImplementation(() => ({
    forTenant: <T>(_tid: string, fn: (db: typeof mockDb) => Promise<T>): Promise<T> => fn(mockDb),
    forSystem: () => mockDb,
  })),
}));

const mockQueueAdd = vi.fn().mockResolvedValue({});

function makeJob(overrides: Partial<DeliveryJob> = {}) {
  const data: DeliveryJob = {
    jobId: 'delivery-001',
    correlationId: 'corr-001' as CorrelationId,
    tenantId: 'tenant-001' as TenantId,
    submissionId: 'sub-001' as SubmissionId,
    partnerProfileId: 'profile-001' as PartnerProfileId,
    payloadRef: 's3://bucket/payload-001',
    normalizedHash: 'abc123hash',
    attempt: 1,
    enqueuedAt: new Date().toISOString(),
    actorId: 'user-001',
    actorRole: 'INTEGRATION_ENGINEER',
    securedPayloadRef: 's3://bucket/secured-001',
    connectorType: 'SFTP',
    ...overrides,
  };
  return { data, attemptsMade: 0 } as any;
}

describe('DeliveryProcessor', () => {
  let processor: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockDeliveryAttemptFindFirst.mockResolvedValue(null); // No existing attempts
    mockDeliveryAttemptCreate.mockResolvedValue({ id: 'attempt-001' });
    mockDeliveryAttemptUpdate.mockResolvedValue({});
    mockSubmissionUpdate.mockResolvedValue({});
    mockAuditCreate.mockResolvedValue({ id: 'audit-001' });

    mockProfileFindFirst.mockResolvedValue({
      id: 'profile-001',
      transportProtocol: 'SFTP',
      environment: 'TEST',
      config: {
        host: '203.130.45.12',
        port: 22,
        hostKeyFingerprint: 'SHA256:abc123',
        remotePath: '/upload',
      },
      status: 'PROD_ACTIVE',
      retryPolicyRef: null,
    });

    const { DatabaseService } = await import('@sep/db');
    const { DeliveryProcessor } = await import('./delivery.processor');

    const dbService = new DatabaseService();
    processor = new DeliveryProcessor(dbService, { add: mockQueueAdd } as any);
  });

  it('delivers successfully and updates submission to SENT', async () => {
    await processor.process(makeJob());

    // DeliveryAttempt created — tenantId must be denormalized from the job
    expect(mockDeliveryAttemptCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-001',
          submissionId: 'sub-001',
          attemptNo: 1,
          connectorType: 'SFTP',
        }),
      }),
    );

    // DeliveryAttempt updated to SUCCESS
    expect(mockDeliveryAttemptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ result: 'SUCCESS' }),
      }),
    );

    // Submission updated to SENT
    expect(mockSubmissionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SENT' }),
      }),
    );

    // Audit event written
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'SUBMISSION_DELIVERED',
          result: 'SUCCESS',
          actorId: 'user-001',
        }),
      }),
    );
  });

  it('skips delivery if attempt already succeeded (idempotency)', async () => {
    mockDeliveryAttemptFindFirst.mockResolvedValue({ id: 'existing', result: 'SUCCESS' });

    await processor.process(makeJob());

    expect(mockDeliveryAttemptCreate).not.toHaveBeenCalled();
    expect(mockSubmissionUpdate).not.toHaveBeenCalled();
  });

  it('creates DeliveryAttempt record before delivery', async () => {
    await processor.process(makeJob());

    // Create should be called before update
    const createCall = mockDeliveryAttemptCreate.mock.invocationCallOrder[0];
    const updateCall = mockDeliveryAttemptUpdate.mock.invocationCallOrder[0];
    expect(createCall).toBeDefined();
    expect(updateCall).toBeDefined();
    expect(createCall).toBeLessThan(updateCall!);
  });

  it('resolves endpoint from partner profile, not job payload', async () => {
    // The job says 'SFTP' but profile config has the actual host
    await processor.process(makeJob());

    // Verify profile was loaded (endpoint comes from there)
    expect(mockProfileFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'profile-001', tenantId: 'tenant-001' },
      }),
    );
  });

  it('preserves actor context in audit events', async () => {
    await processor.process(makeJob());

    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: 'user-001',
          correlationId: 'corr-001',
        }),
      }),
    );
  });
});
