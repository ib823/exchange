import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IncidentsService } from './incidents.service';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '@sep/db';

const mockDb = {
  incident: {
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

const actor = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  role: 'OPERATIONS_ANALYST',
  email: 'ops@tenant.local',
};

const crossTenantActor = {
  userId: 'user-2',
  tenantId: 'tenant-other',
  role: 'OPERATIONS_ANALYST',
  email: 'ops@other.local',
};

const baseIncident = {
  id: 'inc-1',
  tenantId: 'tenant-1',
  severity: 'P2',
  state: 'OPEN',
  title: 'Delivery failure',
  description: 'Partner endpoint unreachable',
  sourceType: 'SYSTEM',
  sourceId: null,
  assignedTo: null,
  resolvedAt: null,
  resolvedBy: null,
  resolution: null,
  escalatedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('IncidentsService', () => {
  let service: IncidentsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new IncidentsService(mockAudit as unknown as AuditService, mockDatabaseService);
  });

  describe('create', () => {
    it('creates an incident and records audit event', async () => {
      mockDb.incident.create.mockResolvedValue(baseIncident);

      const result = await service.create(
        {
          tenantId: 'tenant-1',
          severity: 'P2',
          title: 'Delivery failure',
          description: 'Partner endpoint unreachable',
          sourceType: 'SYSTEM',
          sourceId: undefined,
          assignedTo: undefined,
        },
        actor,
      );

      expect(result).toEqual(baseIncident);
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'INCIDENT_CREATED', result: 'SUCCESS' }),
      );
    });
  });

  describe('findById', () => {
    it('returns incident when actor is tenant owner', async () => {
      mockDb.incident.findUnique.mockResolvedValue(baseIncident);
      const result = await service.findById('inc-1', actor);
      expect(result).toEqual(baseIncident);
    });

    it('throws NotFoundException for cross-tenant access (404, not 403)', async () => {
      mockDb.incident.findUnique.mockResolvedValue(baseIncident);
      await expect(
        service.findById('inc-1', crossTenantActor),
      ).rejects.toThrow('Incident not found');
      await expect(
        service.findById('inc-1', crossTenantActor),
      ).rejects.toThrow(expect.objectContaining({ status: 404 }) as Error);
    });

    it('throws NotFoundException when incident does not exist', async () => {
      mockDb.incident.findUnique.mockResolvedValue(null);
      await expect(
        service.findById('inc-missing', actor),
      ).rejects.toThrow('Incident not found');
    });
  });

  describe('update — severity', () => {
    it('allows severity upgrade (P2 -> P1)', async () => {
      const openIncident = { ...baseIncident, state: 'OPEN', severity: 'P2' };
      const upgradedIncident = { ...baseIncident, severity: 'P1' };
      mockDb.incident.findUnique.mockResolvedValue(openIncident);
      mockDb.incident.update.mockResolvedValue(upgradedIncident);

      const result = await service.update('inc-1', { severity: 'P1', title: undefined, description: undefined, assignedTo: undefined, state: undefined, resolution: undefined }, actor);
      expect(result.severity).toBe('P1');
    });

    it('rejects severity downgrade (P2 -> P3)', async () => {
      const openIncident = { ...baseIncident, state: 'OPEN', severity: 'P2' };
      mockDb.incident.findUnique.mockResolvedValue(openIncident);

      await expect(
        service.update('inc-1', { severity: 'P3', title: undefined, description: undefined, assignedTo: undefined, state: undefined, resolution: undefined }, actor),
      ).rejects.toThrow('VALIDATION_SCHEMA_FAILED');
    });
  });

  describe('update — state transitions', () => {
    it('succeeds for valid OPEN -> TRIAGED transition', async () => {
      const openIncident = { ...baseIncident, state: 'OPEN' };
      const triagedIncident = { ...baseIncident, state: 'TRIAGED' };
      mockDb.incident.findUnique.mockResolvedValue(openIncident);
      mockDb.incident.update.mockResolvedValue(triagedIncident);

      const result = await service.update('inc-1', { state: 'TRIAGED', severity: undefined, title: undefined, description: undefined, assignedTo: undefined, resolution: undefined }, actor);

      expect(result.state).toBe('TRIAGED');
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'INCIDENT_TRIAGED',
          result: 'SUCCESS',
        }),
      );
    });

    it('throws error for invalid OPEN -> RESOLVED transition', async () => {
      const openIncident = { ...baseIncident, state: 'OPEN' };
      mockDb.incident.findUnique.mockResolvedValue(openIncident);

      await expect(
        service.update('inc-1', { state: 'RESOLVED', severity: undefined, title: undefined, description: undefined, assignedTo: undefined, resolution: 'Fixed' }, actor),
      ).rejects.toThrow('VALIDATION_SCHEMA_FAILED');
    });

    it('requires resolution before transitioning to RESOLVED', async () => {
      const inProgressIncident = { ...baseIncident, state: 'IN_PROGRESS', resolution: null };
      mockDb.incident.findUnique.mockResolvedValue(inProgressIncident);

      await expect(
        service.update('inc-1', { state: 'RESOLVED', severity: undefined, title: undefined, description: undefined, assignedTo: undefined, resolution: undefined }, actor),
      ).rejects.toThrow('VALIDATION_SCHEMA_FAILED');
    });

    it('allows RESOLVED transition when resolution is provided', async () => {
      const inProgressIncident = { ...baseIncident, state: 'IN_PROGRESS', resolution: null };
      const resolvedIncident = { ...baseIncident, state: 'RESOLVED', resolution: 'Fixed endpoint', resolvedAt: new Date(), resolvedBy: 'user-1' };
      mockDb.incident.findUnique.mockResolvedValue(inProgressIncident);
      mockDb.incident.update.mockResolvedValue(resolvedIncident);

      const result = await service.update('inc-1', { state: 'RESOLVED', resolution: 'Fixed endpoint', severity: undefined, title: undefined, description: undefined, assignedTo: undefined }, actor);

      expect(result.state).toBe('RESOLVED');
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'INCIDENT_RESOLVED', result: 'SUCCESS' }),
      );
    });

    it('throws error when transitioning from CLOSED (terminal state)', async () => {
      const closedIncident = { ...baseIncident, state: 'CLOSED' };
      mockDb.incident.findUnique.mockResolvedValue(closedIncident);

      await expect(
        service.update('inc-1', { state: 'OPEN', severity: undefined, title: undefined, description: undefined, assignedTo: undefined, resolution: undefined }, actor),
      ).rejects.toThrow('VALIDATION_SCHEMA_FAILED');
    });
  });
});
