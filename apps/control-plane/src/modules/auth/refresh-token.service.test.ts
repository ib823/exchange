/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/unbound-method, no-duplicate-imports */

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

const mockRefreshToken = {
  create: vi.fn().mockResolvedValue({}),
  findUnique: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn().mockResolvedValue({}),
  updateMany: vi.fn().mockResolvedValue({ count: 0 }),
};

const mockTx = {
  refreshToken: mockRefreshToken,
};

const mockSystemClient = {
  refreshToken: mockRefreshToken,
};

const mockDb = {
  forTenant: <T>(_tid: string, fn: (db: typeof mockTx) => Promise<T>): Promise<T> => fn(mockTx),
  forSystem: () => mockSystemClient,
};

import { RefreshTokenService } from './refresh-token.service';

describe('RefreshTokenService', () => {
  let service: RefreshTokenService;
  const hmacKey = Buffer.alloc(32, 0x42);

  beforeEach(() => {
    vi.clearAllMocks();
    mockRefreshToken.updateMany.mockResolvedValue({ count: 0 });
    mockRefreshToken.findMany.mockResolvedValue([]);
    service = new RefreshTokenService(mockDb as any, hmacKey);
  });

  describe('issue', () => {
    it('generates raw token, HMACs it, persists row, returns raw', async () => {
      const issued = await service.issue(mockTx as any, 't-1', 'u-1');
      expect(typeof issued.token).toBe('string');
      expect(issued.token.length).toBeGreaterThan(40); // base64url of 32 bytes = 43 chars
      expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(mockRefreshToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 't-1',
          userId: 'u-1',
          tokenHash: expect.any(String),
        }),
      });
      // Persisted tokenHash must NOT equal the raw token
      const call = mockRefreshToken.create.mock.calls[0][0];
      expect(call.data.tokenHash).not.toBe(issued.token);
      expect(call.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('refresh', () => {
    it('rejects with AUTH_REFRESH_TOKEN_INVALID when row not found', async () => {
      mockRefreshToken.findUnique.mockResolvedValue(null);
      await expect(service.refresh('any-raw-token')).rejects.toMatchObject({
        response: expect.objectContaining({ code: ErrorCode.AUTH_REFRESH_TOKEN_INVALID }),
      });
    });

    it('rejects with AUTH_REFRESH_TOKEN_INVALID when revokedAt is set', async () => {
      mockRefreshToken.findUnique.mockResolvedValue({
        id: 'r-1',
        tenantId: 't-1',
        userId: 'u-1',
        expiresAt: new Date(Date.now() + 86_400_000),
        usedAt: null,
        revokedAt: new Date(),
      });
      await expect(service.refresh('any')).rejects.toMatchObject({
        response: expect.objectContaining({ code: ErrorCode.AUTH_REFRESH_TOKEN_INVALID }),
      });
    });

    it('rejects with AUTH_REFRESH_TOKEN_INVALID when expired', async () => {
      mockRefreshToken.findUnique.mockResolvedValue({
        id: 'r-1',
        tenantId: 't-1',
        userId: 'u-1',
        expiresAt: new Date(Date.now() - 1000),
        usedAt: null,
        revokedAt: null,
      });
      await expect(service.refresh('any')).rejects.toMatchObject({
        response: expect.objectContaining({ code: ErrorCode.AUTH_REFRESH_TOKEN_INVALID }),
      });
    });

    it('triggers chain revocation + AUTH_REFRESH_TOKEN_REPLAY when usedAt is set', async () => {
      mockRefreshToken.findUnique
        .mockResolvedValueOnce({
          // initial lookup in forSystem
          id: 'r-a',
          tenantId: 't-1',
          userId: 'u-1',
          expiresAt: new Date(Date.now() + 86_400_000),
          usedAt: new Date(Date.now() - 60_000),
          revokedAt: null,
        });
      mockRefreshToken.findMany
        .mockResolvedValueOnce([]) // backward walk iter 1 — no parents
        .mockResolvedValueOnce([{ replacedById: null }]); // forward walk iter 1

      await expect(service.refresh('any')).rejects.toMatchObject({
        response: expect.objectContaining({ code: ErrorCode.AUTH_REFRESH_TOKEN_REPLAY }),
      });
      expect(mockRefreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            revocationReason: 'replay-detected',
            revokedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('happy path: rotates the token (marks used, creates new, updates replacedById)', async () => {
      // First findUnique is the forSystem initial lookup
      mockRefreshToken.findUnique.mockResolvedValueOnce({
        id: 'r-a',
        tenantId: 't-1',
        userId: 'u-1',
        expiresAt: new Date(Date.now() + 86_400_000),
        usedAt: null,
        revokedAt: null,
      });
      // Second findUnique is inside forTenant to locate the new row
      // by its hash so we can set replacedById
      mockRefreshToken.findUnique.mockResolvedValueOnce({ id: 'r-b' });

      const result = await service.refresh('any-raw-token');
      expect(result.refreshToken.token).toBeTruthy();
      expect(mockRefreshToken.create).toHaveBeenCalledTimes(1);
      expect(mockRefreshToken.update).toHaveBeenCalledWith({
        where: { id: 'r-a' },
        data: expect.objectContaining({ usedAt: expect.any(Date), replacedById: 'r-b' }),
      });
    });
  });
});
