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

vi.mock('@node-rs/argon2', () => ({
  verify: vi.fn(),
}));

const mockUser = {
  findUnique: vi.fn(),
  update: vi.fn().mockResolvedValue({}),
};
const mockRecoveryCode = {
  update: vi.fn().mockResolvedValue({}),
};
const mockTx = {
  user: mockUser,
  recoveryCode: mockRecoveryCode,
};
const mockDb = {
  forTenant: <T>(_tid: string, fn: (db: typeof mockTx) => Promise<T>): Promise<T> => fn(mockTx),
};

const mockJwt = {
  verify: vi.fn(),
};

const mockAuth = {
  issueToken: vi.fn().mockReturnValue({ accessToken: 'access-token', expiresIn: '15m' }),
};

const mockChallengeStore = {
  consume: vi.fn().mockResolvedValue({ consumed: true }),
};

const mockRefreshTokenService = {
  issue: vi
    .fn()
    .mockResolvedValue({ token: 'refresh-token-raw', expiresAt: new Date(Date.now() + 86_400_000) }),
};

// Minimal ioredis shim — only the ops MfaRecoverService uses.
const mockRedis = {
  incr: vi.fn(),
  expire: vi.fn().mockResolvedValue(1),
  del: vi.fn().mockResolvedValue(1),
};

import { verify as argon2Verify } from '@node-rs/argon2';
import { MfaRecoverService } from './mfa-recover.service';

describe('MfaRecoverService', () => {
  let service: MfaRecoverService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);
    mockRedis.del.mockResolvedValue(1);
    mockChallengeStore.consume.mockResolvedValue({ consumed: true });
    mockRefreshTokenService.issue.mockResolvedValue({
      token: 'refresh-token-raw',
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    service = new MfaRecoverService(
      mockDb as any,
      mockJwt as any,
      mockAuth as any,
      mockChallengeStore as any,
      mockRefreshTokenService as any,
      mockRedis as any,
    );
  });

  function baseJwtPayload() {
    return { typ: 'mfa_challenge', userId: 'u-1', tenantId: 't-1', challengeId: 'ch-1' };
  }

  function userWithCodes(codes: Array<{ id: string; codeHash: string }>) {
    return {
      id: 'u-1',
      tenantId: 't-1',
      email: 'a@b.com',
      mfaEnrolledAt: new Date(),
      lockedUntil: null,
      roleAssignments: [{ role: 'TENANT_ADMIN' }],
      recoveryCodes: codes,
    };
  }

  it('rejects AUTH_MFA_CHALLENGE_INVALID on bad JWT', async () => {
    mockJwt.verify.mockImplementation(() => {
      throw new Error('bad signature');
    });
    await expect(service.recover('bad', 'ABCD1234')).rejects.toMatchObject({
      response: expect.objectContaining({ code: ErrorCode.AUTH_MFA_CHALLENGE_INVALID }),
    });
    expect(mockChallengeStore.consume).not.toHaveBeenCalled();
  });

  it('rejects AUTH_MFA_CHALLENGE_INVALID on wrong typ', async () => {
    mockJwt.verify.mockReturnValue({ ...baseJwtPayload(), typ: 'access' });
    await expect(service.recover('tok', 'ABCD1234')).rejects.toMatchObject({
      response: expect.objectContaining({ code: ErrorCode.AUTH_MFA_CHALLENGE_INVALID }),
    });
    expect(mockChallengeStore.consume).not.toHaveBeenCalled();
  });

  it('rejects AUTH_MFA_CHALLENGE_CONSUMED on replayed challenge', async () => {
    mockJwt.verify.mockReturnValue(baseJwtPayload());
    mockChallengeStore.consume.mockResolvedValueOnce({
      consumed: false,
      reason: 'already-consumed',
    });
    await expect(service.recover('tok', 'ABCD1234')).rejects.toMatchObject({
      response: expect.objectContaining({ code: ErrorCode.AUTH_MFA_CHALLENGE_CONSUMED }),
    });
    expect(mockUser.findUnique).not.toHaveBeenCalled();
  });

  it('rejects AUTH_MFA_CHALLENGE_INVALID when user mfa state cleared since issue', async () => {
    mockJwt.verify.mockReturnValue(baseJwtPayload());
    mockUser.findUnique.mockResolvedValue({ ...userWithCodes([]), mfaEnrolledAt: null });
    await expect(service.recover('tok', 'ABCD1234')).rejects.toMatchObject({
      response: expect.objectContaining({ code: ErrorCode.AUTH_MFA_CHALLENGE_INVALID }),
    });
  });

  it('rejects AUTH_ACCOUNT_LOCKED when user is already locked', async () => {
    mockJwt.verify.mockReturnValue(baseJwtPayload());
    mockUser.findUnique.mockResolvedValue({
      ...userWithCodes([]),
      lockedUntil: new Date(Date.now() + 60_000),
    });
    await expect(service.recover('tok', 'ABCD1234')).rejects.toMatchObject({
      response: expect.objectContaining({ code: ErrorCode.AUTH_ACCOUNT_LOCKED }),
    });
    expect(argon2Verify).not.toHaveBeenCalled();
  });

  it('first wrong code increments counter, applies delay, throws AUTH_RECOVERY_CODE_INVALID', async () => {
    mockJwt.verify.mockReturnValue(baseJwtPayload());
    mockUser.findUnique.mockResolvedValue(
      userWithCodes([{ id: 'rc-1', codeHash: 'argon2-hash-1' }]),
    );
    (argon2Verify as any).mockResolvedValue(false);
    mockRedis.incr.mockResolvedValue(1);

    // Use fake timers so the 1s delay doesn't slow the test.
    vi.useFakeTimers();
    const promise = service.recover('tok', 'ABCD1234').catch((err: unknown) => err);
    await vi.runAllTimersAsync();
    const err = await promise;
    vi.useRealTimers();

    expect((err as { response?: { code?: string } }).response?.code).toBe(
      ErrorCode.AUTH_RECOVERY_CODE_INVALID,
    );
    expect(mockRedis.incr).toHaveBeenCalledWith('sep:mfa-recovery-failures:u-1');
    expect(mockRedis.expire).toHaveBeenCalledWith('sep:mfa-recovery-failures:u-1', 30 * 60);
  });

  it('third consecutive wrong code locks the account (AUTH_ACCOUNT_LOCKED)', async () => {
    mockJwt.verify.mockReturnValue(baseJwtPayload());
    mockUser.findUnique.mockResolvedValue(
      userWithCodes([{ id: 'rc-1', codeHash: 'argon2-hash-1' }]),
    );
    (argon2Verify as any).mockResolvedValue(false);
    mockRedis.incr.mockResolvedValue(3);

    await expect(service.recover('tok', 'ABCD1234')).rejects.toMatchObject({
      response: expect.objectContaining({ code: ErrorCode.AUTH_ACCOUNT_LOCKED }),
    });
    expect(mockUser.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u-1' },
        data: expect.objectContaining({ lockedUntil: expect.any(Date) }),
      }),
    );
    expect(mockRedis.del).toHaveBeenCalledWith('sep:mfa-recovery-failures:u-1');
  });

  it('matching code: consumes it, resets counter, issues access + refresh', async () => {
    mockJwt.verify.mockReturnValue(baseJwtPayload());
    mockUser.findUnique.mockResolvedValue(
      userWithCodes([
        { id: 'rc-1', codeHash: 'argon2-hash-1' },
        { id: 'rc-2', codeHash: 'argon2-hash-2' },
      ]),
    );
    // First hash doesn't match, second does.
    (argon2Verify as any).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const result = await service.recover('tok', 'ABCD1234');
    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken.token).toBe('refresh-token-raw');
    expect(mockRecoveryCode.update).toHaveBeenCalledWith({
      where: { id: 'rc-2' },
      data: expect.objectContaining({ usedAt: expect.any(Date) }),
    });
    expect(mockUser.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: expect.objectContaining({ failedLoginAttempts: 0, lockedUntil: null }),
    });
    expect(mockRedis.del).toHaveBeenCalledWith('sep:mfa-recovery-failures:u-1');
    expect(mockRefreshTokenService.issue).toHaveBeenCalledWith(mockTx, 't-1', 'u-1');
  });
});
