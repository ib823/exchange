import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuditService } from './audit.service';
import { DatabaseService } from '@sep/db';

const mockDb = {
  auditEvent: {
    findFirst: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
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

vi.mock('@sep/common', async () => {
  const actual = await vi.importActual<typeof import('@sep/common')>('@sep/common');
  return {
    ...actual,
    getConfig: (): { audit: { hashSecret: string } } => ({
      audit: { hashSecret: 'test-hash-secret' },
    }),
  };
});

vi.mock('@sep/observability', () => ({
  createLogger: (): Record<string, ReturnType<typeof vi.fn>> => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const baseParams = {
  tenantId: 'tenant-1',
  actorType: 'USER' as const,
  actorId: 'user-1',
  objectType: 'Submission',
  objectId: 'sub-1',
  action: 'SUBMISSION_RECEIVED' as const,
  result: 'SUCCESS' as const,
};

describe('AuditService', () => {
  let service: AuditService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AuditService(mockDatabaseService);
  });

  describe('record', () => {
    it('creates an audit event with genesis hash when no previous events exist', async () => {
      mockDb.auditEvent.findFirst.mockResolvedValue(null);
      mockDb.auditEvent.create.mockResolvedValue({ id: 'evt-1' });

      await service.record(baseParams);

      expect(mockDb.auditEvent.findFirst).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        orderBy: { eventTime: 'desc' },
        select: { immutableHash: true },
      });

      expect(mockDb.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          actorType: 'USER',
          actorId: 'user-1',
          objectType: 'Submission',
          objectId: 'sub-1',
          action: 'SUBMISSION_RECEIVED',
          result: 'SUCCESS',
          previousHash: null,
          immutableHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      });
    });

    it('chains hash from previous event when one exists', async () => {
      const previousHash = 'abc123def456'.padEnd(64, '0');
      mockDb.auditEvent.findFirst.mockResolvedValue({ immutableHash: previousHash });
      mockDb.auditEvent.create.mockResolvedValue({ id: 'evt-2' });

      await service.record(baseParams);

      expect(mockDb.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          previousHash,
          immutableHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      });
    });

    it('produces different hashes for consecutive events (chain integrity)', async () => {
      mockDb.auditEvent.findFirst.mockResolvedValue(null);
      mockDb.auditEvent.create.mockResolvedValue({ id: 'evt-1' });

      await service.record(baseParams);
      const firstCall = mockDb.auditEvent.create.mock.calls[0];
      if (!firstCall) {
        throw new Error('expected first create call');
      }
      const firstHash = (firstCall[0] as { data: { immutableHash: string } }).data.immutableHash;

      mockDb.auditEvent.findFirst.mockResolvedValue({ immutableHash: firstHash });
      mockDb.auditEvent.create.mockResolvedValue({ id: 'evt-2' });

      await service.record({ ...baseParams, action: 'SUBMISSION_VALIDATED' as const });
      const secondCall = mockDb.auditEvent.create.mock.calls[1];
      if (!secondCall) {
        throw new Error('expected second create call');
      }
      const secondHash = (secondCall[0] as { data: { immutableHash: string } }).data.immutableHash;

      expect(firstHash).not.toBe(secondHash);
    });

    it('scopes chain ordering to tenant (tenant isolation)', async () => {
      mockDb.auditEvent.findFirst.mockResolvedValue(null);
      mockDb.auditEvent.create.mockResolvedValue({ id: 'evt-1' });

      await service.record({ ...baseParams, tenantId: 'tenant-A' });

      expect(mockDb.auditEvent.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 'tenant-A' } }),
      );

      await service.record({ ...baseParams, tenantId: 'tenant-B' });

      expect(mockDb.auditEvent.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 'tenant-B' } }),
      );
    });

    it('throws SepError when DB write fails (never swallowed)', async () => {
      mockDb.auditEvent.findFirst.mockResolvedValue(null);
      mockDb.auditEvent.create.mockRejectedValue(new Error('DB connection lost'));

      await expect(service.record(baseParams)).rejects.toThrow('DATABASE_ERROR');
    });

    it('uses application-generated timestamp for both hash and eventTime (Issue 6)', async () => {
      mockDb.auditEvent.findFirst.mockResolvedValue(null);
      mockDb.auditEvent.create.mockResolvedValue({ id: 'evt-1' });

      await service.record(baseParams);

      const createCall = mockDb.auditEvent.create.mock.calls[0];
      if (!createCall) {
        throw new Error('expected create call');
      }
      const createData = (createCall[0] as { data: { eventTime: Date; immutableHash: string } })
        .data;
      expect(createData.eventTime).toBeInstanceOf(Date);
      // The eventTime field is now explicitly set by the service, not left to @default(now())
      expect(createData.eventTime).toBeDefined();
    });

    it('hash chain is reproducible from persisted fields', async () => {
      // Simulate writing 3 events and verifying the chain from persisted data
      const events: Array<{ eventTime: Date; immutableHash: string; previousHash: string | null }> =
        [];

      // Event 1 — genesis
      mockDb.auditEvent.findFirst.mockResolvedValue(null);
      mockDb.auditEvent.create.mockImplementation(
        ({
          data,
        }: {
          data: { eventTime: Date; immutableHash: string; previousHash: string | null };
        }) => {
          events.push({
            eventTime: data.eventTime,
            immutableHash: data.immutableHash,
            previousHash: data.previousHash,
          });
          return Promise.resolve({ id: `evt-${events.length}` });
        },
      );

      await service.record(baseParams);

      // Event 2 — chained to event 1
      const evt0 = events[0] as (typeof events)[number];
      mockDb.auditEvent.findFirst.mockResolvedValue({ immutableHash: evt0.immutableHash });
      await service.record({ ...baseParams, action: 'SUBMISSION_VALIDATED' as const });

      // Event 3 — chained to event 2
      const evt1 = events[1] as (typeof events)[number];
      mockDb.auditEvent.findFirst.mockResolvedValue({ immutableHash: evt1.immutableHash });
      await service.record({ ...baseParams, action: 'SUBMISSION_QUEUED' as const });

      expect(events).toHaveLength(3);
      const evt2 = events[2] as (typeof events)[number];

      // Verify chain linkage
      expect(evt0.previousHash).toBeNull();
      expect(evt1.previousHash).toBe(evt0.immutableHash);
      expect(evt2.previousHash).toBe(evt1.immutableHash);

      // Verify each hash can be recomputed from persisted fields
      const { createHash } = await import('crypto');
      const actions = ['SUBMISSION_RECEIVED', 'SUBMISSION_VALIDATED', 'SUBMISSION_QUEUED'];

      for (let i = 0; i < events.length; i++) {
        const evt = events[i] as (typeof events)[number];
        const action = actions[i] as string;
        const hashInput = [
          baseParams.tenantId,
          baseParams.actorId,
          action,
          baseParams.result,
          evt.eventTime.toISOString(),
          evt.previousHash ?? 'genesis',
          'test-hash-secret',
        ].join('|');
        const expected = createHash('sha256').update(hashInput).digest('hex');
        expect(evt.immutableHash).toBe(expected);
      }
    });

    it('includes optional fields when provided', async () => {
      mockDb.auditEvent.findFirst.mockResolvedValue(null);
      mockDb.auditEvent.create.mockResolvedValue({ id: 'evt-1' });

      await service.record({
        ...baseParams,
        correlationId: 'corr-1',
        traceId: 'trace-1',
        actorRole: 'TENANT_ADMIN' as const,
        environment: 'TEST' as const,
        metadata: { key: 'value' },
      });

      expect(mockDb.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          correlationId: 'corr-1',
          traceId: 'trace-1',
          actorRole: 'TENANT_ADMIN',
          environment: 'TEST',
          metadata: { key: 'value' },
        }),
      });
    });
  });

  describe('search', () => {
    it('applies tenant filter and returns paginated results', async () => {
      const events = [{ id: 'evt-1', tenantId: 'tenant-1', action: 'SUBMISSION_RECEIVED' }];
      mockDb.auditEvent.findMany.mockResolvedValue(events);
      mockDb.auditEvent.count.mockResolvedValue(1);

      const result = await service.search({ tenantId: 'tenant-1', page: 1, pageSize: 20 });

      expect(result.data).toEqual(events);
      expect(result.meta).toEqual({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
      expect(mockDb.auditEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 'tenant-1' },
        }),
      );
    });

    it('does not return immutableHash or previousHash in search results', async () => {
      mockDb.auditEvent.findMany.mockResolvedValue([]);
      mockDb.auditEvent.count.mockResolvedValue(0);

      await service.search({ tenantId: 'tenant-1', page: 1, pageSize: 20 });

      const findManyCall = mockDb.auditEvent.findMany.mock.calls[0];
      if (!findManyCall) {
        throw new Error('expected findMany call');
      }
      const selectArg = (findManyCall[0] as { select: Record<string, boolean> }).select;
      expect(selectArg).not.toHaveProperty('immutableHash');
      expect(selectArg).not.toHaveProperty('previousHash');
      expect(selectArg).toHaveProperty('id', true);
      expect(selectArg).toHaveProperty('action', true);
    });

    it('applies all filter parameters correctly', async () => {
      mockDb.auditEvent.findMany.mockResolvedValue([]);
      mockDb.auditEvent.count.mockResolvedValue(0);

      const from = new Date('2026-01-01');
      const to = new Date('2026-12-31');

      await service.search({
        tenantId: 'tenant-1',
        objectType: 'Submission',
        objectId: 'sub-1',
        action: 'SUBMISSION_RECEIVED',
        actorId: 'user-1',
        correlationId: 'corr-1',
        from,
        to,
        page: 2,
        pageSize: 10,
      });

      expect(mockDb.auditEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: 'tenant-1',
            objectType: 'Submission',
            objectId: 'sub-1',
            action: 'SUBMISSION_RECEIVED',
            actorId: 'user-1',
            correlationId: 'corr-1',
            eventTime: { gte: from, lte: to },
          },
          skip: 10,
          take: 10,
        }),
      );
    });

    it('enforces tenant isolation — cannot search across tenants', async () => {
      mockDb.auditEvent.findMany.mockResolvedValue([]);
      mockDb.auditEvent.count.mockResolvedValue(0);

      await service.search({ tenantId: 'tenant-1', page: 1, pageSize: 20 });

      const tenantScopeCall = mockDb.auditEvent.findMany.mock.calls[0];
      if (!tenantScopeCall) {
        throw new Error('expected findMany call');
      }
      const where = (tenantScopeCall[0] as { where: { tenantId: string } }).where;
      expect(where.tenantId).toBe('tenant-1');
    });
  });
});
