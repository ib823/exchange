import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyReferencesService } from './key-references.service';
import { AuditService } from '../audit/audit.service';

const mockDb = {
  keyReference: {
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

vi.mock('@sep/common', async () => {
  const actual = await vi.importActual('@sep/common');
  return { ...actual, getConfig: (): { crypto: { keyExpiryAlertDays: number } } => ({ crypto: { keyExpiryAlertDays: 30 } }) };
});

const mockAudit = { record: vi.fn().mockResolvedValue(undefined) };

const actor = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  role: 'SECURITY_ADMIN',
  email: 'sec@tenant.local',
};

const crossTenantActor = {
  userId: 'user-2',
  tenantId: 'tenant-other',
  role: 'SECURITY_ADMIN',
  email: 'sec@other.local',
};

const baseKeyRef = {
  id: 'key-1',
  tenantId: 'tenant-1',
  partnerProfileId: 'profile-1',
  name: 'Bank Signing Key',
  usage: ['SIGN'],
  backendType: 'PLATFORM_VAULT',
  fingerprint: 'ABCD1234',
  algorithm: 'RSA-4096',
  version: 1,
  state: 'DRAFT',
  environment: 'TEST',
  activatedAt: null,
  expiresAt: null,
  revokedAt: null,
  rotationTargetId: null,
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('KeyReferencesService', () => {
  let service: KeyReferencesService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new KeyReferencesService(mockAudit as unknown as AuditService);
  });

  describe('create', () => {
    it('creates a key reference and records audit event', async () => {
      mockDb.keyReference.create.mockResolvedValue(baseKeyRef);

      const result = await service.create(
        {
          tenantId: 'tenant-1',
          partnerProfileId: 'profile-1',
          name: 'Bank Signing Key',
          usage: ['SIGN'],
          backendType: 'PLATFORM_VAULT',
          backendRef: 'vault://keys/bank-signing',
          fingerprint: 'ABCD1234',
          algorithm: 'RSA-4096',
          environment: 'TEST',
        },
        actor,
      );

      expect(result).toEqual(baseKeyRef);
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'KEY_REFERENCE_CREATED', result: 'SUCCESS' }),
      );
    });
  });

  describe('findById', () => {
    it('returns key reference when actor is tenant owner', async () => {
      mockDb.keyReference.findUnique.mockResolvedValue(baseKeyRef);
      const result = await service.findById('key-1', actor);
      expect(result.id).toBe('key-1');
    });

    it('throws NotFoundException for cross-tenant access (404, not 403)', async () => {
      mockDb.keyReference.findUnique.mockResolvedValue(baseKeyRef);
      await expect(
        service.findById('key-1', crossTenantActor),
      ).rejects.toThrow('Key reference not found');
      await expect(
        service.findById('key-1', crossTenantActor),
      ).rejects.toThrow(expect.objectContaining({ status: 404 }) as Error);
    });

    it('throws NotFoundException when key reference does not exist', async () => {
      mockDb.keyReference.findUnique.mockResolvedValue(null);
      await expect(
        service.findById('key-missing', actor),
      ).rejects.toThrow('Key reference not found');
    });

    it('adds expiringWithinDays flag for keys expiring within alert window', async () => {
      const expiringKey = {
        ...baseKeyRef,
        state: 'ACTIVE',
        expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 days from now
      };
      mockDb.keyReference.findUnique.mockResolvedValue(expiringKey);

      const result = await service.findById('key-1', actor);
      expect(result.expiringWithinDays).toBeLessThanOrEqual(30);
      expect(result.expiringWithinDays).toBeGreaterThan(0);
    });

    it('sets expiringWithinDays to null for keys not expiring soon', async () => {
      const safeKey = {
        ...baseKeyRef,
        state: 'ACTIVE',
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year from now
      };
      mockDb.keyReference.findUnique.mockResolvedValue(safeKey);

      const result = await service.findById('key-1', actor);
      expect(result.expiringWithinDays).toBeNull();
    });
  });

  describe('activate', () => {
    it('activates a VALIDATED key and records audit event', async () => {
      const validatedKey = { ...baseKeyRef, state: 'VALIDATED' };
      const activatedKey = { ...baseKeyRef, state: 'ACTIVE', activatedAt: new Date() };
      mockDb.keyReference.findUnique.mockResolvedValue(validatedKey);
      mockDb.keyReference.update.mockResolvedValue(activatedKey);

      const result = await service.activate('key-1', actor);

      expect(result.state).toBe('ACTIVE');
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'KEY_REFERENCE_ACTIVATED', result: 'SUCCESS' }),
      );
    });

    it('throws error when activating a non-VALIDATED key', async () => {
      const draftKey = { ...baseKeyRef, state: 'DRAFT' };
      mockDb.keyReference.findUnique.mockResolvedValue(draftKey);

      await expect(
        service.activate('key-1', actor),
      ).rejects.toThrow('VALIDATION_SCHEMA_FAILED');
    });
  });

  describe('revoke', () => {
    it('revokes an ACTIVE key and records audit event', async () => {
      const activeKey = { ...baseKeyRef, state: 'ACTIVE' };
      const revokedKey = { ...baseKeyRef, state: 'REVOKED', revokedAt: new Date() };
      mockDb.keyReference.findUnique.mockResolvedValue(activeKey);
      mockDb.keyReference.update.mockResolvedValue(revokedKey);

      const result = await service.revoke('key-1', actor);

      expect(result.state).toBe('REVOKED');
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'KEY_REFERENCE_REVOKED', result: 'SUCCESS' }),
      );
    });

    it('revokes a ROTATING key', async () => {
      const rotatingKey = { ...baseKeyRef, state: 'ROTATING' };
      const revokedKey = { ...baseKeyRef, state: 'REVOKED', revokedAt: new Date() };
      mockDb.keyReference.findUnique.mockResolvedValue(rotatingKey);
      mockDb.keyReference.update.mockResolvedValue(revokedKey);

      const result = await service.revoke('key-1', actor);
      expect(result.state).toBe('REVOKED');
    });

    it('throws error when revoking a DRAFT key', async () => {
      const draftKey = { ...baseKeyRef, state: 'DRAFT' };
      mockDb.keyReference.findUnique.mockResolvedValue(draftKey);

      await expect(
        service.revoke('key-1', actor),
      ).rejects.toThrow('VALIDATION_SCHEMA_FAILED');
    });
  });
});
