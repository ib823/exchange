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

vi.mock('@sep/common', async () => {
  const actual = await vi.importActual<typeof import('@sep/common')>('@sep/common');
  return {
    ...actual,
    getConfig: () => ({
      auth: { jwtSecret: 'test-secret', jwtExpiry: '15m', jwtIssuer: 'sep-test' },
    }),
  };
});

const mockUser = {
  findUnique: vi.fn(),
  update: vi.fn().mockResolvedValue({}),
};

const mockTx = {
  user: mockUser,
  $queryRaw: vi.fn().mockResolvedValue([{ failedLoginAttempts: 1, lockedUntil: null }]),
};

const mockDb = {
  forTenant: <T>(_tid: string, fn: (db: typeof mockTx) => Promise<T>): Promise<T> => fn(mockTx),
};

const mockJwt = {
  sign: vi.fn().mockReturnValue('mock-jwt-challenge'),
};

const mockAuthService = {
  issueToken: vi
    .fn()
    .mockReturnValue({ accessToken: 'access-token', expiresIn: '15m' }),
};

const mockRefreshTokenService = {
  issue: vi
    .fn()
    .mockResolvedValue({ token: 'refresh-token-raw', expiresAt: new Date(Date.now() + 86_400_000) }),
};

vi.mock('@node-rs/argon2', () => ({
  verify: vi.fn(),
}));

import { verify as argon2Verify } from '@node-rs/argon2';
import { LoginService } from './login.service';

describe('LoginService', () => {
  let service: LoginService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new LoginService(
      mockDb as any,
      mockJwt as any,
      mockAuthService as any,
      mockRefreshTokenService as any,
    );
    mockTx.$queryRaw.mockResolvedValue([{ failedLoginAttempts: 1, lockedUntil: null }]);
    mockRefreshTokenService.issue.mockResolvedValue({
      token: 'refresh-token-raw',
      expiresAt: new Date(Date.now() + 86_400_000),
    });
  });

  it('returns AUTH_INVALID_CREDENTIALS when user not found', async () => {
    mockUser.findUnique.mockResolvedValue(null);
    await expect(service.validatePassword('t-1', 'nope@x.com', 'pw')).rejects.toMatchObject({
      response: expect.objectContaining({ code: ErrorCode.AUTH_INVALID_CREDENTIALS }),
    });
  });

  it('returns AUTH_INVALID_CREDENTIALS when user has null passwordHash (never set password)', async () => {
    mockUser.findUnique.mockResolvedValue({
      id: 'u-1',
      tenantId: 't-1',
      email: 'a@b.com',
      passwordHash: null,
      mfaEnrolledAt: null,
      lockedUntil: null,
      roleAssignments: [],
    });
    await expect(service.validatePassword('t-1', 'a@b.com', 'pw')).rejects.toMatchObject({
      response: expect.objectContaining({ code: ErrorCode.AUTH_INVALID_CREDENTIALS }),
    });
  });

  it('returns AUTH_ACCOUNT_LOCKED when lockedUntil > now (before password check)', async () => {
    mockUser.findUnique.mockResolvedValue({
      id: 'u-1',
      tenantId: 't-1',
      email: 'a@b.com',
      passwordHash: 'hash',
      mfaEnrolledAt: null,
      lockedUntil: new Date(Date.now() + 60_000),
      roleAssignments: [],
    });
    await expect(service.validatePassword('t-1', 'a@b.com', 'pw')).rejects.toMatchObject({
      response: expect.objectContaining({ code: ErrorCode.AUTH_ACCOUNT_LOCKED }),
    });
    expect(argon2Verify).not.toHaveBeenCalled();
  });

  it('runs the atomic lockout UPDATE on wrong password', async () => {
    mockUser.findUnique.mockResolvedValue({
      id: 'u-1',
      tenantId: 't-1',
      email: 'a@b.com',
      passwordHash: 'hash',
      mfaEnrolledAt: null,
      lockedUntil: null,
      roleAssignments: [],
    });
    (argon2Verify as any).mockResolvedValue(false);

    await expect(service.validatePassword('t-1', 'a@b.com', 'wrong')).rejects.toMatchObject({
      response: expect.objectContaining({ code: ErrorCode.AUTH_INVALID_CREDENTIALS }),
    });
    expect(mockTx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('issues access + refresh tokens on correct password with no MFA', async () => {
    mockUser.findUnique.mockResolvedValue({
      id: 'u-1',
      tenantId: 't-1',
      email: 'a@b.com',
      passwordHash: 'hash',
      mfaEnrolledAt: null,
      lockedUntil: null,
      roleAssignments: [{ role: 'TENANT_ADMIN' }],
    });
    (argon2Verify as any).mockResolvedValue(true);

    const result = (await service.validatePassword('t-1', 'a@b.com', 'correct')) as {
      accessToken: string;
      expiresIn: string;
      refreshToken: { token: string; expiresAt: Date };
    };
    expect(result.accessToken).toBe('access-token');
    expect(result.expiresIn).toBe('15m');
    expect(result.refreshToken.token).toBe('refresh-token-raw');
    expect(result.refreshToken.expiresAt).toBeInstanceOf(Date);
    expect(mockRefreshTokenService.issue).toHaveBeenCalledWith(mockTx, 't-1', 'u-1');
    expect(mockUser.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: expect.objectContaining({ failedLoginAttempts: 0, lockedUntil: null }),
    });
    expect(mockTx.$queryRaw).not.toHaveBeenCalled();
  });

  it('issues MFA challenge token when user has mfaEnrolledAt set', async () => {
    mockUser.findUnique.mockResolvedValue({
      id: 'u-1',
      tenantId: 't-1',
      email: 'a@b.com',
      passwordHash: 'hash',
      mfaEnrolledAt: new Date(),
      lockedUntil: null,
      roleAssignments: [{ role: 'TENANT_ADMIN' }],
    });
    (argon2Verify as any).mockResolvedValue(true);

    const result = (await service.validatePassword('t-1', 'a@b.com', 'correct')) as {
      mfaChallengeToken: string;
      expiresIn: string;
    };
    expect(result.mfaChallengeToken).toBe('mock-jwt-challenge');
    expect(result.expiresIn).toBe('5m');
    expect(mockAuthService.issueToken).not.toHaveBeenCalled();
  });
});
