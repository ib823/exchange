import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TenantsService } from './tenants.service';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '@sep/db';

const mockDb = {
  tenant: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
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

const mockAudit = { record: vi.fn().mockResolvedValue(undefined) };

const adminActor = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  role: 'PLATFORM_SUPER_ADMIN',
  email: 'admin@sep.local',
};

const tenantActor = {
  userId: 'user-2',
  tenantId: 'tenant-1',
  role: 'TENANT_ADMIN',
  email: 'admin@tenant.local',
};

describe('TenantsService', () => {
  let service: TenantsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TenantsService(mockAudit as unknown as AuditService, mockDatabaseService);
  });

  describe('create', () => {
    it('creates a tenant and records audit event', async () => {
      const created = { id: 'tenant-new', name: 'ACME', legalEntityName: 'ACME Sdn Bhd', serviceTier: 'STANDARD', defaultRegion: 'ap-southeast-1', status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date() };
      mockDb.tenant.create.mockResolvedValue(created);

      const result = await service.create(
        { name: 'ACME', legalEntityName: 'ACME Sdn Bhd', serviceTier: 'STANDARD', defaultRegion: 'ap-southeast-1' },
        adminActor,
      );

      expect(result).toEqual(created);
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'TENANT_CREATED', result: 'SUCCESS' }),
      );
    });
  });

  describe('findById', () => {
    it('returns tenant when actor is owner', async () => {
      const tenant = { id: 'tenant-1', name: 'ACME', status: 'ACTIVE' };
      mockDb.tenant.findUnique.mockResolvedValue(tenant);
      const result = await service.findById('tenant-1', tenantActor);
      expect(result).toEqual(tenant);
    });

    it('throws NotFoundException when tenant does not belong to actor', async () => {
      const tenant = { id: 'tenant-2', name: 'OTHER', status: 'ACTIVE' };
      mockDb.tenant.findUnique.mockResolvedValue(tenant);
      await expect(
        service.findById('tenant-2', tenantActor),
      ).rejects.toThrow('Tenant not found');
    });

    it('returns 404 (not 403) on cross-tenant access to prevent enumeration', async () => {
      const tenant = { id: 'tenant-2', name: 'OTHER', status: 'ACTIVE' };
      mockDb.tenant.findUnique.mockResolvedValue(tenant);
      await expect(
        service.findById('tenant-2', tenantActor),
      ).rejects.toThrow(expect.objectContaining({ status: 404 }) as Error);
    });

    it('throws NotFoundException when tenant does not exist', async () => {
      mockDb.tenant.findUnique.mockResolvedValue(null);
      await expect(
        service.findById('tenant-missing', adminActor),
      ).rejects.toThrow('Tenant not found');
    });

    it('allows PLATFORM_SUPER_ADMIN to view any tenant', async () => {
      const tenant = { id: 'tenant-2', name: 'OTHER', status: 'ACTIVE' };
      mockDb.tenant.findUnique.mockResolvedValue(tenant);
      const result = await service.findById('tenant-2', adminActor);
      expect(result).toEqual(tenant);
    });
  });

  describe('suspend', () => {
    it('suspends tenant and records audit event', async () => {
      const tenant = { id: 'tenant-1', status: 'ACTIVE' };
      const suspended = { ...tenant, status: 'SUSPENDED', name: 'ACME' };
      mockDb.tenant.findUnique.mockResolvedValue(tenant);
      mockDb.tenant.update.mockResolvedValue(suspended);

      const result = await service.suspend('tenant-1', adminActor);

      expect(result.status).toBe('SUSPENDED');
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'TENANT_SUSPENDED', result: 'SUCCESS' }),
      );
    });

    it('throws NotFoundException when non-admin tries to suspend another tenant', async () => {
      const tenant = { id: 'tenant-2', status: 'ACTIVE' };
      mockDb.tenant.findUnique.mockResolvedValue(tenant);

      await expect(
        service.suspend('tenant-2', tenantActor),
      ).rejects.toThrow('Tenant not found');
    });

    it('allows PLATFORM_SUPER_ADMIN to suspend any tenant', async () => {
      const tenant = { id: 'tenant-2', status: 'ACTIVE' };
      const suspended = { ...tenant, status: 'SUSPENDED', name: 'OTHER' };
      mockDb.tenant.findUnique.mockResolvedValue(tenant);
      mockDb.tenant.update.mockResolvedValue(suspended);

      const result = await service.suspend('tenant-2', adminActor);
      expect(result.status).toBe('SUSPENDED');
    });
  });

  describe('update', () => {
    it('updates tenant and records audit event', async () => {
      const existing = { id: 'tenant-1', name: 'OLD', legalEntityName: 'OLD Sdn Bhd', status: 'ACTIVE' };
      const updated = { ...existing, name: 'NEW' };
      mockDb.tenant.findUnique.mockResolvedValue(existing);
      mockDb.tenant.update.mockResolvedValue(updated);

      const result = await service.update('tenant-1', { name: 'NEW' }, tenantActor);

      expect(result.name).toBe('NEW');
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'TENANT_UPDATED', result: 'SUCCESS' }),
      );
    });
  });
});
