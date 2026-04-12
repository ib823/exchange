import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PartnerProfilesService } from './partner-profiles.service';
import { AuditService } from '../audit/audit.service';

const mockDb = {
  partnerProfile: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
  },
  approval: {
    findFirst: vi.fn(),
  },
};

vi.mock('@sep/db', () => ({
  getPrismaClient: (): typeof mockDb => mockDb,
  Prisma: { JsonNull: 'DbNull' },
}));

const mockAudit = { record: vi.fn().mockResolvedValue(undefined) };

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

const baseProfile = {
  id: 'profile-1',
  tenantId: 'tenant-1',
  name: 'Bank H2H',
  partnerType: 'BANK',
  environment: 'TEST',
  version: 1,
  status: 'DRAFT',
  transportProtocol: 'SFTP',
  messageSecurityMode: 'SIGN_ENCRYPT',
  payloadContractRef: null,
  retryPolicyRef: null,
  keyPolicyRef: null,
  config: {},
  notes: null,
  effectiveDate: null,
  expiryDate: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('PartnerProfilesService', () => {
  let service: PartnerProfilesService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PartnerProfilesService(mockAudit as unknown as AuditService);
  });

  describe('create', () => {
    it('creates a partner profile and records audit event', async () => {
      mockDb.partnerProfile.create.mockResolvedValue(baseProfile);

      const result = await service.create(
        {
          tenantId: 'tenant-1',
          name: 'Bank H2H',
          partnerType: 'BANK',
          environment: 'TEST',
          transportProtocol: 'SFTP',
          messageSecurityMode: 'SIGN_ENCRYPT',
          config: {},
        },
        actor,
      );

      expect(result).toEqual(baseProfile);
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PARTNER_PROFILE_CREATED', result: 'SUCCESS' }),
      );
    });
  });

  describe('findById', () => {
    it('returns profile when actor is tenant owner', async () => {
      mockDb.partnerProfile.findUnique.mockResolvedValue(baseProfile);
      const result = await service.findById('profile-1', actor);
      expect(result).toEqual(baseProfile);
    });

    it('throws NotFoundException for cross-tenant access (404, not 403)', async () => {
      mockDb.partnerProfile.findUnique.mockResolvedValue(baseProfile);
      await expect(
        service.findById('profile-1', crossTenantActor),
      ).rejects.toThrow('Partner profile not found');
      await expect(
        service.findById('profile-1', crossTenantActor),
      ).rejects.toThrow(expect.objectContaining({ status: 404 }) as Error);
    });

    it('throws NotFoundException when profile does not exist', async () => {
      mockDb.partnerProfile.findUnique.mockResolvedValue(null);
      await expect(
        service.findById('profile-missing', actor),
      ).rejects.toThrow('Partner profile not found');
    });
  });

  describe('transition', () => {
    it('succeeds for valid DRAFT -> TEST_READY transition', async () => {
      const draftProfile = { ...baseProfile, status: 'DRAFT' };
      const updatedProfile = { ...baseProfile, status: 'TEST_READY', version: 2 };
      mockDb.partnerProfile.findUnique.mockResolvedValue(draftProfile);
      mockDb.partnerProfile.update.mockResolvedValue(updatedProfile);

      const result = await service.transition('profile-1', 'TEST_READY', actor);

      expect(result.status).toBe('TEST_READY');
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PARTNER_PROFILE_STATUS_CHANGED',
          result: 'SUCCESS',
          metadata: { from: 'DRAFT', to: 'TEST_READY' },
        }),
      );
    });

    it('throws error for invalid DRAFT -> PROD_ACTIVE transition', async () => {
      const draftProfile = { ...baseProfile, status: 'DRAFT' };
      mockDb.partnerProfile.findUnique.mockResolvedValue(draftProfile);

      await expect(
        service.transition('profile-1', 'PROD_ACTIVE', actor),
      ).rejects.toThrow('VALIDATION_SCHEMA_FAILED');
    });

    it('requires approval for PROD_PENDING_APPROVAL -> PROD_ACTIVE transition', async () => {
      const pendingProfile = { ...baseProfile, status: 'PROD_PENDING_APPROVAL' };
      mockDb.partnerProfile.findUnique.mockResolvedValue(pendingProfile);
      mockDb.approval.findFirst.mockResolvedValue(null);

      await expect(
        service.transition('profile-1', 'PROD_ACTIVE', actor),
      ).rejects.toThrow('dual-control approval');
    });

    it('allows PROD_PENDING_APPROVAL -> PROD_ACTIVE when approval exists with distinct approver', async () => {
      const pendingProfile = { ...baseProfile, status: 'PROD_PENDING_APPROVAL' };
      const activeProfile = { ...baseProfile, status: 'PROD_ACTIVE', version: 2 };
      mockDb.partnerProfile.findUnique.mockResolvedValue(pendingProfile);
      mockDb.approval.findFirst.mockResolvedValue({ id: 'approval-1', status: 'APPROVED', initiatorId: 'user-A', approverId: 'user-B' });
      mockDb.partnerProfile.update.mockResolvedValue(activeProfile);

      const result = await service.transition('profile-1', 'PROD_ACTIVE', actor);
      expect(result.status).toBe('PROD_ACTIVE');
    });

    it('rejects PROD_PENDING_APPROVAL -> PROD_ACTIVE when initiator equals approver', async () => {
      const pendingProfile = { ...baseProfile, status: 'PROD_PENDING_APPROVAL' };
      mockDb.partnerProfile.findUnique.mockResolvedValue(pendingProfile);
      mockDb.approval.findFirst.mockResolvedValue({ id: 'approval-1', status: 'APPROVED', initiatorId: 'user-A', approverId: 'user-A' });

      await expect(
        service.transition('profile-1', 'PROD_ACTIVE', actor),
      ).rejects.toThrow('Initiator and approver must be different users');
    });

    it('allows SUSPENDED -> PROD_ACTIVE without approval (resume)', async () => {
      const suspendedProfile = { ...baseProfile, status: 'SUSPENDED' };
      const activeProfile = { ...baseProfile, status: 'PROD_ACTIVE', version: 2 };
      mockDb.partnerProfile.findUnique.mockResolvedValue(suspendedProfile);
      mockDb.partnerProfile.update.mockResolvedValue(activeProfile);

      const result = await service.transition('profile-1', 'PROD_ACTIVE', actor);
      expect(result.status).toBe('PROD_ACTIVE');
      expect(mockDb.approval.findFirst).not.toHaveBeenCalled();
    });

    it('throws error when transitioning from RETIRED (terminal state)', async () => {
      const retiredProfile = { ...baseProfile, status: 'RETIRED' };
      mockDb.partnerProfile.findUnique.mockResolvedValue(retiredProfile);

      await expect(
        service.transition('profile-1', 'DRAFT', actor),
      ).rejects.toThrow('VALIDATION_SCHEMA_FAILED');
    });
  });

  describe('update', () => {
    it('rejects update for non-DRAFT profiles', async () => {
      const activeProfile = { ...baseProfile, status: 'PROD_ACTIVE' };
      mockDb.partnerProfile.findUnique.mockResolvedValue(activeProfile);

      await expect(
        service.update('profile-1', { name: 'Updated' }, actor),
      ).rejects.toThrow('VALIDATION_SCHEMA_FAILED');
    });
  });
});
