import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebhooksService } from './webhooks.service';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '@sep/db';

const mockDb = {
  webhook: {
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
  forTenant: <T>(_tid: string, fn: (db: typeof mockDb) => Promise<T>): Promise<T> => fn(mockDb),
  forSystem: (): typeof mockDb => mockDb,
} as unknown as DatabaseService;

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

const baseWebhook = {
  id: 'wh-1',
  tenantId: 'tenant-1',
  url: 'https://example.com/webhook',
  events: ['SUBMISSION_COMPLETED', 'SUBMISSION_FAILED'],
  active: true,
  successCount: 0,
  failureCount: 0,
  lastFiredAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('WebhooksService', () => {
  let service: WebhooksService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new WebhooksService(mockAudit as unknown as AuditService, mockDatabaseService);
  });

  describe('create', () => {
    it('creates a webhook and records audit event', async () => {
      mockDb.webhook.create.mockResolvedValue(baseWebhook);

      const result = await service.create(
        {
          tenantId: 'tenant-1',
          url: 'https://example.com/webhook',
          events: ['SUBMISSION_COMPLETED', 'SUBMISSION_FAILED'],
          secretRef: 'vault://secrets/wh-1',
        },
        actor,
      );

      expect(result).toEqual(baseWebhook);
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'WEBHOOK_REGISTERED', result: 'SUCCESS' }),
      );
    });
  });

  describe('findById', () => {
    it('returns webhook when actor is tenant owner', async () => {
      mockDb.webhook.findUnique.mockResolvedValue(baseWebhook);
      const result = await service.findById('wh-1', actor);
      expect(result).toEqual(baseWebhook);
    });

    it('throws NotFoundException for cross-tenant access (404, not 403)', async () => {
      mockDb.webhook.findUnique.mockResolvedValue(baseWebhook);
      await expect(service.findById('wh-1', crossTenantActor)).rejects.toThrow('Webhook not found');
      await expect(service.findById('wh-1', crossTenantActor)).rejects.toThrow(
        expect.objectContaining({ status: 404 }) as Error,
      );
    });

    it('throws NotFoundException when webhook does not exist', async () => {
      mockDb.webhook.findUnique.mockResolvedValue(null);
      await expect(service.findById('wh-missing', actor)).rejects.toThrow('Webhook not found');
    });
  });

  describe('deactivate', () => {
    it('deactivates a webhook and records audit event', async () => {
      const deactivated = { ...baseWebhook, active: false };
      mockDb.webhook.findUnique.mockResolvedValue(baseWebhook);
      mockDb.webhook.update.mockResolvedValue(deactivated);

      const result = await service.deactivate('wh-1', actor);

      expect(result.active).toBe(false);
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'WEBHOOK_DEACTIVATED',
          result: 'SUCCESS',
        }),
      );
    });
  });

  describe('SSRF protection', () => {
    it('rejects webhook URL resolving to 127.0.0.1', async () => {
      await expect(
        service.create(
          {
            tenantId: 'tenant-1',
            url: 'https://127.0.0.1/hook',
            events: ['SUBMISSION_COMPLETED'],
            secretRef: 'vault://s',
          },
          actor,
        ),
      ).rejects.toThrow('VALIDATION_SCHEMA_FAILED');
    });

    it('rejects webhook URL resolving to 169.254.169.254 (cloud metadata)', async () => {
      await expect(
        service.create(
          {
            tenantId: 'tenant-1',
            url: 'http://169.254.169.254/latest/meta-data/',
            events: ['SUBMISSION_COMPLETED'],
            secretRef: 'vault://s',
          },
          actor,
        ),
      ).rejects.toThrow('VALIDATION_SCHEMA_FAILED');
    });

    it('rejects webhook URL resolving to 10.0.0.1 (private range)', async () => {
      await expect(
        service.create(
          {
            tenantId: 'tenant-1',
            url: 'https://10.0.0.1/internal',
            events: ['SUBMISSION_COMPLETED'],
            secretRef: 'vault://s',
          },
          actor,
        ),
      ).rejects.toThrow('VALIDATION_SCHEMA_FAILED');
    });

    it('rejects webhook URL to localhost', async () => {
      await expect(
        service.create(
          {
            tenantId: 'tenant-1',
            url: 'https://localhost/hook',
            events: ['SUBMISSION_COMPLETED'],
            secretRef: 'vault://s',
          },
          actor,
        ),
      ).rejects.toThrow('VALIDATION_SCHEMA_FAILED');
    });

    it('accepts a valid public webhook URL', async () => {
      mockDb.webhook.create.mockResolvedValue(baseWebhook);
      const result = await service.create(
        {
          tenantId: 'tenant-1',
          url: 'https://hooks.example.com/events',
          events: ['SUBMISSION_COMPLETED'],
          secretRef: 'vault://s',
        },
        actor,
      );
      expect(result).toEqual(baseWebhook);
    });
  });

  describe('findAll', () => {
    it('returns paginated webhooks for the actor tenant', async () => {
      mockDb.webhook.findMany.mockResolvedValue([baseWebhook]);
      mockDb.webhook.count.mockResolvedValue(1);

      const result = await service.findAll(actor, 1, 20);

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
    });
  });
});
