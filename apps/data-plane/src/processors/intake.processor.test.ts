/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, no-duplicate-imports */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorCode } from '@sep/common';
import type {
  SubmissionJob,
  CorrelationId,
  TenantId,
  SubmissionId,
  PartnerProfileId,
} from '@sep/common';

vi.mock('@sep/observability', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  submissionCounter: { inc: vi.fn() },
}));

vi.mock('@sep/common', async () => {
  const actual = await vi.importActual<typeof import('@sep/common')>('@sep/common');
  return {
    ...actual,
    getConfig: () => ({
      audit: { hashSecret: 'test-hash-secret-minimum-32-characters' },
      storage: { maxPayloadSizeBytes: 52_428_800 },
      features: { malwareScanEnabled: false },
    }),
  };
});

const mockObjectStorage = {
  getObject: vi.fn().mockResolvedValue(Buffer.from('test content')),
  putObject: vi.fn().mockResolvedValue(undefined),
  getObjectHead: vi.fn().mockResolvedValue(Buffer.from('test content')),
};

// Mock DatabaseService
const mockFindFirst = vi.fn();
const mockUpdate = vi.fn();
const mockCreate = vi.fn();
const mockDb = {
  submission: { findFirst: mockFindFirst, update: mockUpdate },
  partnerProfile: { findFirst: vi.fn() },
  auditEvent: { findFirst: vi.fn().mockResolvedValue(null), create: mockCreate },
};

vi.mock('@sep/db', () => ({
  DatabaseService: vi.fn().mockImplementation(() => ({
    forTenant: <T>(_tid: string, fn: (db: typeof mockDb) => Promise<T>): Promise<T> => fn(mockDb),
    forSystem: () => mockDb,
  })),
}));

// Mock BullMQ
const mockQueueAdd = vi.fn().mockResolvedValue({});

function makeJob(overrides: Partial<SubmissionJob> = {}) {
  const data: SubmissionJob = {
    jobId: 'job-001',
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
    credentialId: 'cred-001',
    ...overrides,
  };
  return { data, attemptsMade: 0 } as any;
}

describe('IntakeProcessor', () => {
  let processor: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Default mocks
    mockFindFirst.mockResolvedValue({
      id: 'sub-001',
      tenantId: 'tenant-001',
      status: 'RECEIVED',
      normalizedHash: 'abc123hash',
      payloadSize: 1024,
      metadata: null,
    });

    mockDb.partnerProfile.findFirst.mockResolvedValue({
      id: 'profile-001',
      messageSecurityMode: 'SIGN_ENCRYPT',
      transportProtocol: 'SFTP',
      environment: 'TEST',
      status: 'PROD_ACTIVE',
      config: { keyReferenceId: 'key-001' },
    });

    mockUpdate.mockResolvedValue({});
    mockCreate.mockResolvedValue({ id: 'audit-001' });

    const { DatabaseService } = await import('@sep/db');
    const { IntakeProcessor } = await import('./intake.processor');

    const dbService = new DatabaseService();
    processor = new IntakeProcessor(dbService, { add: mockQueueAdd } as any, mockObjectStorage);
  });

  it('processes a valid submission through intake pipeline', async () => {
    await processor.process(makeJob());

    // Verify submission updated to VALIDATED then QUEUED
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sub-001' },
        data: expect.objectContaining({ status: 'VALIDATED' }),
      }),
    );
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sub-001' },
        data: expect.objectContaining({ status: 'QUEUED' }),
      }),
    );

    // Verify crypto job enqueued
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'crypto',
      expect.objectContaining({
        submissionId: 'sub-001',
        operation: 'SIGN_ENCRYPT',
        keyReferenceId: 'key-001',
        actorId: 'user-001',
      }),
      expect.anything(),
    );
  });

  it('skips intake if submission is already past RECEIVED', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'sub-001',
      tenantId: 'tenant-001',
      status: 'QUEUED',
      normalizedHash: 'abc123hash',
      metadata: null,
    });

    await processor.process(makeJob());
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('fails submission on hash mismatch', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'sub-001',
      tenantId: 'tenant-001',
      status: 'RECEIVED',
      normalizedHash: 'different-hash',
      metadata: null,
      payloadSize: 100,
    });

    await expect(processor.process(makeJob())).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.SUBMISSION_PAYLOAD_TAMPERED }),
    );

    // Verify submission failed
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED_FINAL',
          errorCode: ErrorCode.SUBMISSION_PAYLOAD_TAMPERED,
        }),
      }),
    );
  });

  it('fails submission when profile is inactive', async () => {
    mockDb.partnerProfile.findFirst.mockResolvedValue({
      id: 'profile-001',
      messageSecurityMode: 'NONE',
      transportProtocol: 'SFTP',
      environment: 'TEST',
      status: 'SUSPENDED',
      config: {},
    });

    await expect(processor.process(makeJob())).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.POLICY_PROFILE_INACTIVE }),
    );
  });

  it('rejects filename with path traversal', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'sub-001',
      tenantId: 'tenant-001',
      status: 'RECEIVED',
      normalizedHash: 'abc123hash',
      metadata: { filename: '../../../etc/passwd' },
      payloadSize: 100,
    });

    await expect(processor.process(makeJob())).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.VALIDATION_FILENAME_INVALID }),
    );
  });

  it('rejects filename with null bytes', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'sub-001',
      tenantId: 'tenant-001',
      status: 'RECEIVED',
      normalizedHash: 'abc123hash',
      metadata: { filename: 'file\0.txt' },
      payloadSize: 100,
    });

    await expect(processor.process(makeJob())).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.VALIDATION_FILENAME_INVALID }),
    );
  });

  it('enqueues directly for delivery when messageSecurityMode is NONE', async () => {
    mockDb.partnerProfile.findFirst.mockResolvedValue({
      id: 'profile-001',
      messageSecurityMode: 'NONE',
      transportProtocol: 'HTTPS',
      environment: 'TEST',
      status: 'PROD_ACTIVE',
      config: {},
    });

    await processor.process(makeJob());

    expect(mockQueueAdd).toHaveBeenCalledWith(
      'delivery',
      expect.objectContaining({
        connectorType: 'HTTPS',
      }),
      expect.anything(),
    );
  });

  it('preserves actor context in enqueued jobs', async () => {
    await processor.process(makeJob());

    expect(mockQueueAdd).toHaveBeenCalledWith(
      'crypto',
      expect.objectContaining({
        actorId: 'user-001',
        actorRole: 'INTEGRATION_ENGINEER',
        credentialId: 'cred-001',
      }),
      expect.anything(),
    );
  });

  it('writes audit event with correct fields', async () => {
    await processor.process(makeJob());

    // Audit event for SUBMISSION_QUEUED
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-001',
          action: 'SUBMISSION_QUEUED',
          result: 'SUCCESS',
          correlationId: 'corr-001',
          actorId: 'user-001',
        }),
      }),
    );
  });

  // ── Issue 1: Magic-byte validation ───────────────────────────────────────
  it('rejects payload with .xml extension but PDF magic bytes', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'sub-001',
      tenantId: 'tenant-001',
      status: 'RECEIVED',
      normalizedHash: 'abc123hash',
      metadata: { filename: 'report.xml' },
      payloadSize: 100,
    });
    // PDF magic bytes: %PDF
    mockObjectStorage.getObjectHead.mockResolvedValue(Buffer.from('%PDF-1.4', 'utf-8'));

    await expect(processor.process(makeJob())).rejects.toThrow(
      expect.objectContaining({ code: 'VALIDATION_MAGIC_BYTES_MISMATCH' }),
    );
  });

  it('accepts payload with .pdf extension and correct PDF magic bytes', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'sub-001',
      tenantId: 'tenant-001',
      status: 'RECEIVED',
      normalizedHash: 'abc123hash',
      metadata: { filename: 'report.pdf' },
      payloadSize: 100,
    });
    // Real PDF magic bytes
    mockObjectStorage.getObjectHead.mockResolvedValue(
      Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]),
    );

    await processor.process(makeJob());
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'QUEUED' }) }),
    );
  });

  it('allows files with unknown extensions through (no magic-byte check)', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'sub-001',
      tenantId: 'tenant-001',
      status: 'RECEIVED',
      normalizedHash: 'abc123hash',
      metadata: { filename: 'data.csv' },
      payloadSize: 100,
    });

    await processor.process(makeJob());
    // Should not call getObjectHead for unknown extensions
    expect(mockObjectStorage.getObjectHead).not.toHaveBeenCalled();
  });

  it('fails closed when storage is unavailable during magic-byte check', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'sub-001',
      tenantId: 'tenant-001',
      status: 'RECEIVED',
      normalizedHash: 'abc123hash',
      metadata: { filename: 'report.pdf' },
      payloadSize: 100,
    });
    mockObjectStorage.getObjectHead.mockRejectedValue(new Error('connection refused'));

    await expect(processor.process(makeJob())).rejects.toThrow(
      expect.objectContaining({ code: 'STORAGE_DOWNLOAD_FAILED' }),
    );
  });

  // ── Issue 1: Malware scan config naming ──────────────────────────────────
  // The config variable naming fix is verified by the config unit test
  // (packages/common/src/config/config.test.ts).
  // The malware scan gate behavior is verified here by inspecting the processor
  // code path: when cfg.features.malwareScanEnabled is true, the processor
  // rejects with SUBMISSION_SCAN_UNAVAILABLE before queueing.
  // This test verifies the gate fires using the mock config override.
  it('rejects submission when malware scan enabled but scanner unavailable', async () => {
    // Temporarily override getConfig to return malwareScanEnabled: true
    const common = await import('@sep/common');
    const originalGetConfig = common.getConfig;
    const mockGetConfig = vi.spyOn(common, 'getConfig').mockReturnValue({
      ...originalGetConfig(),
      features: { ...originalGetConfig().features, malwareScanEnabled: true },
    } as any);

    try {
      mockFindFirst.mockResolvedValue({
        id: 'sub-001',
        tenantId: 'tenant-001',
        status: 'RECEIVED',
        normalizedHash: 'abc123hash',
        metadata: null,
        payloadSize: 100,
      });

      await expect(processor.process(makeJob())).rejects.toThrow(
        expect.objectContaining({ code: 'SUBMISSION_SCAN_UNAVAILABLE' }),
      );

      // Submission must be marked FAILED_FINAL — not queued
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED_FINAL' }),
        }),
      );

      // Must not be enqueued
      expect(mockQueueAdd).not.toHaveBeenCalled();
    } finally {
      mockGetConfig.mockRestore();
    }
  });
});
