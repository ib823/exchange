import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SubmissionsService } from './submissions.service';
import { AuditService } from '../audit/audit.service';

const mockDb = {
  submission: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
  },
};

vi.mock('@sep/db', () => ({
  getPrismaClient: (): typeof mockDb => mockDb,
  Prisma: { JsonNull: 'DbNull' },
}));

const mockAudit = {
  record: vi.fn().mockResolvedValue(undefined),
  search: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 } }),
};

const actor = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  role: 'INTEGRATION_ENGINEER',
  email: 'eng@tenant.local',
};

const crossTenantActor = {
  userId: 'user-2',
  tenantId: 'tenant-other',
  role: 'INTEGRATION_ENGINEER',
  email: 'eng@other.local',
};

const baseSubmission = {
  id: 'sub-1',
  tenantId: 'tenant-1',
  sourceSystemId: null,
  exchangeProfileId: null,
  partnerProfileId: 'profile-1',
  direction: 'OUTBOUND',
  correlationId: 'corr-1',
  idempotencyKey: 'idem-1',
  contentType: 'application/json',
  payloadRef: null,
  normalizedHash: null,
  payloadSize: null,
  status: 'RECEIVED',
  errorCode: null,
  errorMessage: null,
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('SubmissionsService', () => {
  let service: SubmissionsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SubmissionsService(mockAudit as unknown as AuditService);
  });

  describe('create', () => {
    it('creates a submission and records audit event', async () => {
      // First findUnique checks idempotency key — no duplicate
      mockDb.submission.findUnique.mockResolvedValueOnce(null);
      mockDb.submission.create.mockResolvedValue(baseSubmission);

      const result = await service.create(
        {
          tenantId: 'tenant-1',
          partnerProfileId: 'profile-1',
          contentType: 'application/json',
          idempotencyKey: 'idem-1',
        },
        actor,
      );

      expect(result.submissionId).toBe('sub-1');
      expect(result.status).toBe('RECEIVED');
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SUBMISSION_RECEIVED', result: 'SUCCESS' }),
      );
    });

    it('rejects duplicate idempotency key', async () => {
      mockDb.submission.findUnique.mockResolvedValueOnce(baseSubmission);

      await expect(
        service.create(
          {
            tenantId: 'tenant-1',
            partnerProfileId: 'profile-1',
            contentType: 'application/json',
            idempotencyKey: 'idem-1',
          },
          actor,
        ),
      ).rejects.toThrow('idempotency key has already been processed');
    });
  });

  describe('findById', () => {
    it('returns submission when actor is tenant owner', async () => {
      mockDb.submission.findUnique.mockResolvedValue(baseSubmission);
      const result = await service.findById('sub-1', actor);
      expect(result).toEqual(baseSubmission);
    });

    it('throws NotFoundException for cross-tenant access (404, not 403)', async () => {
      mockDb.submission.findUnique.mockResolvedValue(baseSubmission);
      await expect(
        service.findById('sub-1', crossTenantActor),
      ).rejects.toThrow('Submission not found');
      await expect(
        service.findById('sub-1', crossTenantActor),
      ).rejects.toThrow(expect.objectContaining({ status: 404 }) as Error);
    });

    it('throws NotFoundException when submission does not exist', async () => {
      mockDb.submission.findUnique.mockResolvedValue(null);
      await expect(
        service.findById('sub-missing', actor),
      ).rejects.toThrow('Submission not found');
    });
  });

  describe('cancel', () => {
    it('cancels a non-terminal submission and records audit event', async () => {
      const receivedSub = { ...baseSubmission, status: 'RECEIVED' };
      const cancelledSub = { ...baseSubmission, status: 'CANCELLED' };
      mockDb.submission.findUnique.mockResolvedValue(receivedSub);
      mockDb.submission.update.mockResolvedValue(cancelledSub);

      const result = await service.cancel('sub-1', actor);

      expect(result.status).toBe('CANCELLED');
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SUBMISSION_CANCELLED', result: 'SUCCESS' }),
      );
    });

    it('throws error when cancelling a terminal-state submission (COMPLETED)', async () => {
      const completedSub = { ...baseSubmission, status: 'COMPLETED' };
      mockDb.submission.findUnique.mockResolvedValue(completedSub);

      await expect(
        service.cancel('sub-1', actor),
      ).rejects.toThrow('SUBMISSION_TERMINAL_STATE');
    });

    it('throws error when cancelling a terminal-state submission (FAILED_FINAL)', async () => {
      const failedSub = { ...baseSubmission, status: 'FAILED_FINAL' };
      mockDb.submission.findUnique.mockResolvedValue(failedSub);

      await expect(
        service.cancel('sub-1', actor),
      ).rejects.toThrow('SUBMISSION_TERMINAL_STATE');
    });
  });
});
