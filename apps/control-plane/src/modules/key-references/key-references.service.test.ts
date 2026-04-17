import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyReferencesService } from './key-references.service';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '@sep/db';

const mockDb = {
  keyReference: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
  },
  approval: {
    findFirst: vi.fn(),
  },
  incident: {
    create: vi.fn(),
  },
};

vi.mock('@sep/db', async () => {
  const actual = await vi.importActual('@sep/db');
  return { ...actual, Prisma: { JsonNull: 'DbNull' } };
});

const mockDatabaseService = {
  forTenant: (): typeof mockDb => mockDb,
  forSystem: (): typeof mockDb => mockDb,
} as unknown as DatabaseService;

vi.mock('@sep/common', async () => {
  const actual = await vi.importActual('@sep/common');
  return {
    ...actual,
    getConfig: (): { crypto: { keyExpiryAlertDays: number } } => ({
      crypto: { keyExpiryAlertDays: 30 },
    }),
  };
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
    service = new KeyReferencesService(mockAudit as unknown as AuditService, mockDatabaseService);
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
      await expect(service.findById('key-1', crossTenantActor)).rejects.toThrow(
        'Key reference not found',
      );
      await expect(service.findById('key-1', crossTenantActor)).rejects.toThrow(
        expect.objectContaining({ status: 404 }) as Error,
      );
    });

    it('throws NotFoundException when key reference does not exist', async () => {
      mockDb.keyReference.findUnique.mockResolvedValue(null);
      await expect(service.findById('key-missing', actor)).rejects.toThrow(
        'Key reference not found',
      );
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

      await expect(service.activate('key-1', actor)).rejects.toThrow('VALIDATION_SCHEMA_FAILED');
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

      await expect(service.revoke('key-1', actor)).rejects.toThrow('VALIDATION_SCHEMA_FAILED');
    });
  });

  describe('dual-control for production keys', () => {
    const prodKey = { ...baseKeyRef, state: 'VALIDATED', environment: 'PRODUCTION' };
    const activeProdKey = { ...baseKeyRef, state: 'ACTIVE', environment: 'PRODUCTION' };
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);

    it('rejects activating a PRODUCTION key without an approved Approval', async () => {
      mockDb.keyReference.findUnique.mockResolvedValue(prodKey);
      mockDb.approval.findFirst.mockResolvedValue(null);

      await expect(service.activate('key-1', actor)).rejects.toThrowError(
        expect.objectContaining({ code: 'APPROVAL_REQUIRED' }) as Error,
      );
    });

    it('activates a PRODUCTION key when an approved Approval exists', async () => {
      const activatedKey = { ...prodKey, state: 'ACTIVE', activatedAt: new Date() };
      mockDb.keyReference.findUnique.mockResolvedValue(prodKey);
      mockDb.approval.findFirst.mockResolvedValue({
        id: 'appr-1',
        initiatorId: 'user-other',
        approverId: 'user-1',
        status: 'APPROVED',
        expiresAt: futureDate,
      });
      mockDb.keyReference.update.mockResolvedValue(activatedKey);

      const result = await service.activate('key-1', actor);
      expect(result.state).toBe('ACTIVE');
    });

    it('rejects activating a PRODUCTION key with self-approved Approval', async () => {
      mockDb.keyReference.findUnique.mockResolvedValue(prodKey);
      mockDb.approval.findFirst.mockResolvedValue({
        id: 'appr-1',
        initiatorId: 'user-same',
        approverId: 'user-same',
        status: 'APPROVED',
        expiresAt: futureDate,
      });

      await expect(service.activate('key-1', actor)).rejects.toThrowError(
        expect.objectContaining({ code: 'APPROVAL_SELF_APPROVAL_FORBIDDEN' }) as Error,
      );
    });

    it('rejects revoking a PRODUCTION key without an approved Approval', async () => {
      mockDb.keyReference.findUnique.mockResolvedValue(activeProdKey);
      mockDb.approval.findFirst.mockResolvedValue(null);

      await expect(service.revoke('key-1', actor)).rejects.toThrowError(
        expect.objectContaining({ code: 'APPROVAL_REQUIRED' }) as Error,
      );
    });

    it('revokes a PRODUCTION key when an approved Approval exists', async () => {
      const revokedKey = { ...activeProdKey, state: 'REVOKED', revokedAt: new Date() };
      mockDb.keyReference.findUnique.mockResolvedValue(activeProdKey);
      mockDb.approval.findFirst.mockResolvedValue({
        id: 'appr-2',
        initiatorId: 'user-other',
        approverId: 'user-1',
        status: 'APPROVED',
        expiresAt: futureDate,
      });
      mockDb.keyReference.update.mockResolvedValue(revokedKey);

      const result = await service.revoke('key-1', actor);
      expect(result.state).toBe('REVOKED');
    });

    it('allows activating a TEST key without approval', async () => {
      const testKey = { ...baseKeyRef, state: 'VALIDATED', environment: 'TEST' };
      const activatedKey = { ...testKey, state: 'ACTIVE', activatedAt: new Date() };
      mockDb.keyReference.findUnique.mockResolvedValue(testKey);
      mockDb.keyReference.update.mockResolvedValue(activatedKey);

      const result = await service.activate('key-1', actor);
      expect(result.state).toBe('ACTIVE');
      expect(mockDb.approval.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('key state machine — SUSPENDED, COMPROMISED, DESTROYED', () => {
    const activeKey = { ...baseKeyRef, state: 'ACTIVE', environment: 'TEST' };
    const suspendedKey = { ...baseKeyRef, state: 'SUSPENDED' };
    const compromisedKey = { ...baseKeyRef, state: 'COMPROMISED', revokedAt: new Date() };
    const revokedKey = { ...baseKeyRef, state: 'REVOKED', revokedAt: new Date() };

    it('suspends an ACTIVE key', async () => {
      mockDb.keyReference.findUnique.mockResolvedValue(activeKey);
      mockDb.keyReference.update.mockResolvedValue(suspendedKey);

      const result = await service.suspend('key-1', actor);
      expect(result.state).toBe('SUSPENDED');
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'KEY_REFERENCE_SUSPENDED' }),
      );
    });

    it('rejects suspending a DRAFT key', async () => {
      mockDb.keyReference.findUnique.mockResolvedValue(baseKeyRef);
      await expect(service.suspend('key-1', actor)).rejects.toThrow('VALIDATION_SCHEMA_FAILED');
    });

    it('reinstates a SUSPENDED key to ACTIVE', async () => {
      mockDb.keyReference.findUnique.mockResolvedValue(suspendedKey);
      mockDb.keyReference.update.mockResolvedValue({ ...baseKeyRef, state: 'ACTIVE' });

      const result = await service.reinstate('key-1', actor);
      expect(result.state).toBe('ACTIVE');
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'KEY_REFERENCE_REINSTATED' }),
      );
    });

    it('rejects reinstating an ACTIVE key', async () => {
      mockDb.keyReference.findUnique.mockResolvedValue(activeKey);
      await expect(service.reinstate('key-1', actor)).rejects.toThrow('VALIDATION_SCHEMA_FAILED');
    });

    it('marks key as COMPROMISED and creates P1 incident', async () => {
      mockDb.keyReference.findUnique.mockResolvedValue(activeKey);
      mockDb.keyReference.update.mockResolvedValue(compromisedKey);
      mockDb.incident.create.mockResolvedValue({ id: 'inc-1' });

      const result = await service.markCompromised('key-1', actor, 'Private key exposed');
      expect(result.state).toBe('COMPROMISED');
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'KEY_REFERENCE_COMPROMISED' }),
      );
      expect(mockDb.incident.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          severity: 'P1',
          sourceType: 'KEY_COMPROMISE',
          sourceId: 'key-1',
        }),
      });
    });

    it('rejects marking a DESTROYED key as compromised', async () => {
      const destroyedKey = { ...baseKeyRef, state: 'DESTROYED' };
      mockDb.keyReference.findUnique.mockResolvedValue(destroyedKey);
      await expect(service.markCompromised('key-1', actor, 'reason')).rejects.toThrow(
        'VALIDATION_SCHEMA_FAILED',
      );
    });

    it('destroys a REVOKED key', async () => {
      mockDb.keyReference.findUnique.mockResolvedValue(revokedKey);
      mockDb.keyReference.update.mockResolvedValue({ ...baseKeyRef, state: 'DESTROYED' });

      const result = await service.destroy('key-1', actor);
      expect(result.state).toBe('DESTROYED');
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'KEY_REFERENCE_DESTROYED' }),
      );
    });

    it('rejects destroying an ACTIVE key', async () => {
      mockDb.keyReference.findUnique.mockResolvedValue(activeKey);
      await expect(service.destroy('key-1', actor)).rejects.toThrow('VALIDATION_SCHEMA_FAILED');
    });
  });
});
