/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorCode } from '@sep/common';

vi.mock('@sep/observability', () => ({
  createLogger: (): unknown => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@sep/common', async () => {
  const actual = await vi.importActual<typeof import('@sep/common')>('@sep/common');
  return {
    ...actual,
    getConfig: (): {
      rateLimit: {
        tenantQuotaStandardPerDay: number;
        tenantQuotaDedicatedPerDay: number;
        tenantQuotaPrivatePerDay: number;
      };
    } => ({
      rateLimit: {
        tenantQuotaStandardPerDay: 3, // tiny caps so tests are fast
        tenantQuotaDedicatedPerDay: 10,
        tenantQuotaPrivatePerDay: Number.MAX_SAFE_INTEGER,
      },
    }),
  };
});

const mockRedis = {
  incr: vi.fn(),
  decr: vi.fn(),
  expire: vi.fn().mockResolvedValue(1),
  get: vi.fn(),
};

import { SubmissionQuotaService } from './submission-quota.service';

describe('SubmissionQuotaService', () => {
  let service: SubmissionQuotaService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.decr.mockResolvedValue(0);
    mockRedis.expire.mockResolvedValue(1);
    mockRedis.get.mockResolvedValue('0');
    service = new SubmissionQuotaService(mockRedis as any);
  });

  describe('charge', () => {
    it('first request sets TTL on the counter', async () => {
      mockRedis.incr.mockResolvedValueOnce(1);
      await service.charge('tenant-1', 'STANDARD');
      expect(mockRedis.expire).toHaveBeenCalledWith(expect.stringContaining('tenant-1'), 48 * 3600);
    });

    it('subsequent requests skip TTL (already set by first)', async () => {
      mockRedis.incr.mockResolvedValueOnce(2);
      await service.charge('tenant-1', 'STANDARD');
      expect(mockRedis.expire).not.toHaveBeenCalled();
    });

    it('uses UTC day in the key shape', async () => {
      mockRedis.incr.mockResolvedValueOnce(1);
      await service.charge('tenant-42', 'STANDARD');
      const firstCall = mockRedis.incr.mock.calls[0];
      if (firstCall === undefined) {
        throw new Error('expected incr to have been called');
      }
      const key = firstCall[0] as string;
      expect(key).toMatch(/^quota:tenant-42:\d{4}-\d{2}-\d{2}$/);
    });

    it('throws TENANT_QUOTA_EXCEEDED when STANDARD tier crosses its cap (3 for this test)', async () => {
      mockRedis.incr.mockResolvedValueOnce(4);
      await expect(service.charge('tenant-1', 'STANDARD')).rejects.toMatchObject({
        code: ErrorCode.TENANT_QUOTA_EXCEEDED,
      });
    });

    it('refunds (DECR) the counter when the tier cap is crossed', async () => {
      mockRedis.incr.mockResolvedValueOnce(4);
      await expect(service.charge('tenant-1', 'STANDARD')).rejects.toBeDefined();
      expect(mockRedis.decr).toHaveBeenCalledWith(expect.stringContaining('tenant-1'));
    });

    it('error message carries tier cap but NOT the current count (no traffic leak)', async () => {
      mockRedis.incr.mockResolvedValueOnce(4);
      try {
        await service.charge('tenant-1', 'STANDARD');
      } catch (err) {
        const msg = (err as Error).message;
        expect(msg).toContain('STANDARD');
        expect(msg).toContain('3'); // the cap — already public
        expect(msg).not.toMatch(/\b4\b/); // current count — keep private
      }
    });

    it('DEDICATED tier permits requests beyond STANDARD cap', async () => {
      mockRedis.incr.mockResolvedValueOnce(5);
      // 5 < 10 (DEDICATED cap) → no throw
      await expect(service.charge('tenant-1', 'DEDICATED')).resolves.toBeUndefined();
    });

    it('PRIVATE tier effectively unlimited (does not throw even at absurd counts)', async () => {
      mockRedis.incr.mockResolvedValueOnce(1_000_000_000);
      await expect(service.charge('tenant-1', 'PRIVATE')).resolves.toBeUndefined();
    });

    it('Redis DECR failure on refund path does not shadow the quota error', async () => {
      mockRedis.incr.mockResolvedValueOnce(4);
      mockRedis.decr.mockRejectedValueOnce(new Error('redis unavailable'));
      await expect(service.charge('tenant-1', 'STANDARD')).rejects.toMatchObject({
        code: ErrorCode.TENANT_QUOTA_EXCEEDED,
      });
    });
  });

  describe('currentCount', () => {
    it('returns 0 when no key exists', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      expect(await service.currentCount('tenant-1')).toBe(0);
    });

    it('returns parsed integer when key exists', async () => {
      mockRedis.get.mockResolvedValueOnce('42');
      expect(await service.currentCount('tenant-1')).toBe(42);
    });

    it('returns null on Redis failure (dashboards render gracefully)', async () => {
      mockRedis.get.mockRejectedValueOnce(new Error('redis unavailable'));
      expect(await service.currentCount('tenant-1')).toBeNull();
    });
  });
});
