/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/unbound-method, no-duplicate-imports --
 * Mock-driven service test — vi.fn() shapes trip the strict rules. */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSecret, generate } from 'otplib';

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
      auth: { jwtIssuer: 'sep-test' },
    }),
  };
});

vi.mock('qrcode', () => ({
  toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,FAKE'),
}));

vi.mock('@node-rs/argon2', () => ({
  hash: vi.fn().mockImplementation((v: string) => Promise.resolve(`argon2$${v}`)),
}));

const mockUser = {
  findUnique: vi.fn(),
  update: vi.fn().mockResolvedValue({}),
};

const mockRecoveryCode = {
  createMany: vi.fn().mockResolvedValue({ count: 10 }),
};

const mockTenantClient = {
  user: mockUser,
  recoveryCode: mockRecoveryCode,
};

const mockDb = {
  forTenant: <T>(_tid: string, fn: (db: typeof mockTenantClient) => Promise<T>): Promise<T> =>
    fn(mockTenantClient),
};

const mockVault = {
  storeSecret: vi.fn().mockResolvedValue('platform/mfa-secrets/user-1'),
  retrieveSecret: vi.fn(),
  destroySecret: vi.fn().mockResolvedValue(undefined),
  pathFor: (id: string) => `platform/mfa-secrets/${id}`,
};

import { MfaService } from './mfa.service';

describe('MfaService', () => {
  let service: MfaService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.update.mockResolvedValue({});
    mockRecoveryCode.createMany.mockResolvedValue({ count: 10 });
    mockVault.storeSecret.mockResolvedValue('platform/mfa-secrets/user-1');
    service = new MfaService(mockDb as any, mockVault as any);
  });

  describe('enroll', () => {
    it('generates a secret, stores in Vault, persists the ref, returns provisioning material', async () => {
      mockUser.findUnique.mockResolvedValue({
        id: 'user-1',
        mfaSecretRef: null,
        mfaEnrolledAt: null,
      });

      const result = await service.enroll('user-1', 'tenant-1', 'alice@example.com');

      expect(mockVault.storeSecret).toHaveBeenCalledWith('user-1', expect.any(String));
      expect(mockUser.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { mfaSecretRef: 'platform/mfa-secrets/user-1' },
      });
      expect(result.provisioningUri).toMatch(/^otpauth:\/\/totp\//);
      expect(result.qrDataUrl).toBe('data:image/png;base64,FAKE');
    });

    it('refuses when the user is already activated (ConflictException)', async () => {
      mockUser.findUnique.mockResolvedValue({
        id: 'user-1',
        mfaSecretRef: 'platform/mfa-secrets/user-1',
        mfaEnrolledAt: new Date(),
      });

      await expect(service.enroll('user-1', 'tenant-1', 'a@b.com')).rejects.toThrow(
        /Conflict|MFA already activated/i,
      );
      expect(mockVault.storeSecret).not.toHaveBeenCalled();
    });

    it('allows re-enroll when secret was stored but activation never completed', async () => {
      mockUser.findUnique.mockResolvedValue({
        id: 'user-1',
        mfaSecretRef: 'platform/mfa-secrets/user-1',
        mfaEnrolledAt: null,
      });
      await service.enroll('user-1', 'tenant-1', 'a@b.com');
      expect(mockVault.storeSecret).toHaveBeenCalledTimes(1);
    });
  });

  describe('activate', () => {
    it('verifies a valid TOTP code, sets mfaEnrolledAt, issues 10 recovery codes', async () => {
      mockUser.findUnique.mockResolvedValue({
        id: 'user-1',
        mfaSecretRef: 'platform/mfa-secrets/user-1',
        mfaEnrolledAt: null,
      });
      // Use a REAL secret and compute the current TOTP so otplib
      // accepts it. This also exercises the ±1 window config.
      const realSecret = generateSecret();
      mockVault.retrieveSecret.mockResolvedValue(realSecret);
      const validCode = await generate({ secret: realSecret });

      const result = await service.activate('user-1', 'tenant-1', validCode);

      expect(result.recoveryCodes).toHaveLength(10);
      expect(mockUser.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { mfaEnrolledAt: expect.any(Date) },
      });
      expect(mockRecoveryCode.createMany).toHaveBeenCalledTimes(1);
      const firstCreateManyCall = mockRecoveryCode.createMany.mock.calls[0];
      if (firstCreateManyCall === undefined) {
        throw new Error('expected createMany to have been called');
      }
      const insertedRows = firstCreateManyCall[0].data;
      expect(insertedRows).toHaveLength(10);
      // Each inserted row carries an argon2-hashed codeHash
      for (const row of insertedRows) {
        expect(row.codeHash).toMatch(/^argon2\$/);
        expect(row.tenantId).toBe('tenant-1');
        expect(row.userId).toBe('user-1');
      }
    });

    it('rejects a wrong TOTP code (BadRequestException), no activation, no codes issued', async () => {
      mockUser.findUnique.mockResolvedValue({
        id: 'user-1',
        mfaSecretRef: 'platform/mfa-secrets/user-1',
        mfaEnrolledAt: null,
      });
      mockVault.retrieveSecret.mockResolvedValue(generateSecret());
      await expect(service.activate('user-1', 'tenant-1', '000000')).rejects.toThrow(
        /TOTP|AUTH_TOKEN_INVALID/i,
      );
      expect(mockUser.update).not.toHaveBeenCalled();
      expect(mockRecoveryCode.createMany).not.toHaveBeenCalled();
    });

    it('refuses activation when no enrollment was started (BadRequestException)', async () => {
      mockUser.findUnique.mockResolvedValue({
        id: 'user-1',
        mfaSecretRef: null,
        mfaEnrolledAt: null,
      });
      await expect(service.activate('user-1', 'tenant-1', '123456')).rejects.toThrow(
        /enrollment has not been started/i,
      );
    });

    it('refuses activation when already activated (ConflictException)', async () => {
      mockUser.findUnique.mockResolvedValue({
        id: 'user-1',
        mfaSecretRef: 'platform/mfa-secrets/user-1',
        mfaEnrolledAt: new Date(),
      });
      await expect(service.activate('user-1', 'tenant-1', '123456')).rejects.toThrow(
        /already activated/i,
      );
    });

    it('issued recovery codes are 8 base32 chars each, unique within the batch', async () => {
      mockUser.findUnique.mockResolvedValue({
        id: 'user-1',
        mfaSecretRef: 'platform/mfa-secrets/user-1',
        mfaEnrolledAt: null,
      });
      const realSecret = generateSecret();
      mockVault.retrieveSecret.mockResolvedValue(realSecret);
      const validCode = await generate({ secret: realSecret });

      const result = await service.activate('user-1', 'tenant-1', validCode);

      for (const code of result.recoveryCodes) {
        expect(code).toMatch(/^[A-Z2-7]{8}$/);
      }
      expect(new Set(result.recoveryCodes).size).toBe(result.recoveryCodes.length);
    });
  });
});
