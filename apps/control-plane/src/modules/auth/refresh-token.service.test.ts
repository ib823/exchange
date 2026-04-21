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

  // Valid envelope: <cuid>.<rawBytes>. The rawBytes value doesn't
  // matter for mocked tests — only the prefix is parsed.
  const TENANT_ID = 'ctestabcd1tenantrefresh001';
  const validEnvelope = `${TENANT_ID}.raw-bytes-value`;

  describe('issue', () => {
    it('generates envelope <tenantId>.<rawBytes>, HMACs whole token, persists row', async () => {
      const issued = await service.issue(mockTx as any, TENANT_ID, 'u-1');
      expect(typeof issued.token).toBe('string');
      expect(issued.token.startsWith(`${TENANT_ID}.`)).toBe(true);
      expect(issued.token.length).toBeGreaterThan(TENANT_ID.length + 1 + 40);
      expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(mockRefreshToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          userId: 'u-1',
          tokenHash: expect.any(String),
        }),
      });
      // Persisted tokenHash must NOT equal the raw token
      const firstCall = mockRefreshToken.create.mock.calls[0];
      if (firstCall === undefined) {
        throw new Error('expected create to have been called');
      }
      const call = firstCall[0];
      expect(call.data.tokenHash).not.toBe(issued.token);
      expect(call.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('refresh', () => {
    it('rejects AUTH_REFRESH_TOKEN_INVALID on malformed envelope (no tenant prefix)', async () => {
      await expect(service.refresh('malformed-no-dot')).rejects.toMatchObject({
        response: expect.objectContaining({ code: ErrorCode.AUTH_REFRESH_TOKEN_INVALID }),
      });
      // The service should short-circuit before any DB call.
      expect(mockRefreshToken.findUnique).not.toHaveBeenCalled();
    });

    it('rejects AUTH_REFRESH_TOKEN_INVALID on malformed envelope (non-cuid tenant)', async () => {
      await expect(service.refresh('not-a-cuid.somebytes')).rejects.toMatchObject({
        response: expect.objectContaining({ code: ErrorCode.AUTH_REFRESH_TOKEN_INVALID }),
      });
      expect(mockRefreshToken.findUnique).not.toHaveBeenCalled();
    });

    it('rejects with AUTH_REFRESH_TOKEN_INVALID when row not found', async () => {
      mockRefreshToken.findUnique.mockResolvedValue(null);
      await expect(service.refresh(validEnvelope)).rejects.toMatchObject({
        response: expect.objectContaining({ code: ErrorCode.AUTH_REFRESH_TOKEN_INVALID }),
      });
    });

    it('rejects with AUTH_REFRESH_TOKEN_INVALID when revokedAt is set', async () => {
      mockRefreshToken.findUnique.mockResolvedValue({
        id: 'r-1',
        tenantId: TENANT_ID,
        userId: 'u-1',
        expiresAt: new Date(Date.now() + 86_400_000),
        usedAt: null,
        revokedAt: new Date(),
      });
      await expect(service.refresh(validEnvelope)).rejects.toMatchObject({
        response: expect.objectContaining({ code: ErrorCode.AUTH_REFRESH_TOKEN_INVALID }),
      });
    });

    it('rejects with AUTH_REFRESH_TOKEN_INVALID when expired', async () => {
      mockRefreshToken.findUnique.mockResolvedValue({
        id: 'r-1',
        tenantId: TENANT_ID,
        userId: 'u-1',
        expiresAt: new Date(Date.now() - 1000),
        usedAt: null,
        revokedAt: null,
      });
      await expect(service.refresh(validEnvelope)).rejects.toMatchObject({
        response: expect.objectContaining({ code: ErrorCode.AUTH_REFRESH_TOKEN_INVALID }),
      });
    });

    it('triggers chain revocation + AUTH_REFRESH_TOKEN_REPLAY when usedAt is set', async () => {
      mockRefreshToken.findUnique.mockResolvedValueOnce({
        id: 'r-a',
        tenantId: TENANT_ID,
        userId: 'u-1',
        expiresAt: new Date(Date.now() + 86_400_000),
        usedAt: new Date(Date.now() - 60_000),
        revokedAt: null,
      });
      mockRefreshToken.findMany
        .mockResolvedValueOnce([]) // backward walk iter 1 — no parents
        .mockResolvedValueOnce([{ replacedById: null }]); // forward walk iter 1

      await expect(service.refresh(validEnvelope)).rejects.toMatchObject({
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
      // First findUnique is the initial tenant-scoped lookup
      mockRefreshToken.findUnique.mockResolvedValueOnce({
        id: 'r-a',
        tenantId: TENANT_ID,
        userId: 'u-1',
        expiresAt: new Date(Date.now() + 86_400_000),
        usedAt: null,
        revokedAt: null,
      });
      // Second findUnique locates the freshly-issued row by hash so
      // we can set replacedById on the old row.
      mockRefreshToken.findUnique.mockResolvedValueOnce({ id: 'r-b' });

      const result = await service.refresh(validEnvelope);
      expect(result.refreshToken.token).toBeTruthy();
      expect(result.refreshToken.token.startsWith(`${TENANT_ID}.`)).toBe(true);
      expect(mockRefreshToken.create).toHaveBeenCalledTimes(1);
      expect(mockRefreshToken.update).toHaveBeenCalledWith({
        where: { id: 'r-a' },
        data: expect.objectContaining({ usedAt: expect.any(Date), replacedById: 'r-b' }),
      });
    });
  });
});
