import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApprovalsService } from './approvals.service';
import { AuditService } from '../audit/audit.service';

const mockDb = {
  approval: {
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

const mockAudit = { record: vi.fn().mockResolvedValue(undefined) };

const actor = {
  userId: 'user-approver',
  tenantId: 'tenant-1',
  role: 'SECURITY_ADMIN',
  email: 'approver@tenant.local',
};

const crossTenantActor = {
  userId: 'user-other',
  tenantId: 'tenant-other',
  role: 'SECURITY_ADMIN',
  email: 'approver@other.local',
};

const initiatorActor = {
  userId: 'user-initiator',
  tenantId: 'tenant-1',
  role: 'INTEGRATION_ENGINEER',
  email: 'initiator@tenant.local',
};

const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // 1 day from now
const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago

const baseApproval = {
  id: 'approval-1',
  tenantId: 'tenant-1',
  action: 'ACTIVATE_PRODUCTION_PROFILE',
  objectType: 'PartnerProfile',
  objectId: 'profile-1',
  partnerProfileId: 'profile-1',
  initiatorId: 'user-initiator',
  approverId: null,
  status: 'PENDING',
  initiatedAt: new Date(),
  expiresAt: futureDate,
  respondedAt: null,
  notes: null,
  diffSnapshot: {},
};

describe('ApprovalsService', () => {
  let service: ApprovalsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ApprovalsService(mockAudit as unknown as AuditService);
  });

  describe('findById', () => {
    it('returns approval when actor is tenant owner', async () => {
      mockDb.approval.findUnique.mockResolvedValue(baseApproval);
      const result = await service.findById('approval-1', actor);
      expect(result).toEqual(baseApproval);
    });

    it('throws NotFoundException for cross-tenant access (404, not 403)', async () => {
      mockDb.approval.findUnique.mockResolvedValue(baseApproval);
      await expect(
        service.findById('approval-1', crossTenantActor),
      ).rejects.toThrow('Approval not found');
      await expect(
        service.findById('approval-1', crossTenantActor),
      ).rejects.toThrow(expect.objectContaining({ status: 404 }) as Error);
    });

    it('throws NotFoundException when approval does not exist', async () => {
      mockDb.approval.findUnique.mockResolvedValue(null);
      await expect(
        service.findById('approval-missing', actor),
      ).rejects.toThrow('Approval not found');
    });
  });

  describe('approve', () => {
    it('approves a pending approval and records audit event', async () => {
      const approvedResult = { ...baseApproval, status: 'APPROVED', approverId: 'user-approver', respondedAt: new Date() };
      mockDb.approval.findUnique.mockResolvedValue(baseApproval);
      mockDb.approval.update.mockResolvedValue(approvedResult);

      const result = await service.approve('approval-1', actor, 'Looks good');

      expect(result.status).toBe('APPROVED');
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'APPROVAL_GRANTED', result: 'SUCCESS' }),
      );
    });

    it('prevents self-approval (initiatorId === actorId)', async () => {
      mockDb.approval.findUnique.mockResolvedValue(baseApproval);

      await expect(
        service.approve('approval-1', initiatorActor, undefined),
      ).rejects.toThrow('Initiator and approver must be different users');
    });

    it('throws error when approval is already in non-PENDING state', async () => {
      const alreadyApproved = { ...baseApproval, status: 'APPROVED' };
      mockDb.approval.findUnique.mockResolvedValue(alreadyApproved);

      await expect(
        service.approve('approval-1', actor, undefined),
      ).rejects.toThrow('VALIDATION_SCHEMA_FAILED');
    });

    it('throws error when approval has expired', async () => {
      const expiredApproval = { ...baseApproval, expiresAt: pastDate };
      mockDb.approval.findUnique.mockResolvedValue(expiredApproval);

      await expect(
        service.approve('approval-1', actor, undefined),
      ).rejects.toThrow('APPROVAL_EXPIRED');
    });
  });

  describe('reject', () => {
    it('rejects a pending approval and records audit event', async () => {
      const rejectedResult = { ...baseApproval, status: 'REJECTED', approverId: 'user-approver', respondedAt: new Date() };
      mockDb.approval.findUnique.mockResolvedValue(baseApproval);
      mockDb.approval.update.mockResolvedValue(rejectedResult);

      const result = await service.reject('approval-1', actor, 'Not ready');

      expect(result.status).toBe('REJECTED');
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'APPROVAL_REJECTED', result: 'SUCCESS' }),
      );
    });

    it('throws error when rejecting an already-responded approval', async () => {
      const alreadyRejected = { ...baseApproval, status: 'REJECTED' };
      mockDb.approval.findUnique.mockResolvedValue(alreadyRejected);

      await expect(
        service.reject('approval-1', actor, undefined),
      ).rejects.toThrow('VALIDATION_SCHEMA_FAILED');
    });

    it('throws error when approval has expired', async () => {
      const expiredApproval = { ...baseApproval, expiresAt: pastDate };
      mockDb.approval.findUnique.mockResolvedValue(expiredApproval);

      await expect(
        service.reject('approval-1', actor, undefined),
      ).rejects.toThrow('APPROVAL_EXPIRED');
    });
  });
});
