/* eslint-disable @typescript-eslint/unbound-method --
 * VaultClient is a vi.fn()-stubbed mock; expect(mock.method) is a
 * vitest assertion target, not a runtime method dispatch. */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorCode } from '@sep/common';
import type { VaultClient } from '@sep/crypto';
import { MfaSecretVaultService } from './mfa-secret-vault.service';

vi.mock('@sep/observability', () => ({
  createLogger: (): unknown => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function makeVault(overrides: Partial<VaultClient> = {}): VaultClient {
  return {
    kvWrite: vi.fn().mockResolvedValue({ data: { version: 1, created_time: new Date().toISOString() } }),
    kvRead: vi.fn(),
    kvDestroyAllVersions: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as VaultClient;
}

describe('MfaSecretVaultService', () => {
  let vault: VaultClient;
  let service: MfaSecretVaultService;

  beforeEach(() => {
    vault = makeVault();
    service = new MfaSecretVaultService(vault);
  });

  describe('pathFor', () => {
    it('builds the platform/mfa-secrets/<userId> path', () => {
      expect(service.pathFor('user-001')).toBe('platform/mfa-secrets/user-001');
    });

    it('rejects empty userId', () => {
      expect(() => service.pathFor('')).toThrowError(/tenant context/i);
    });
  });

  describe('storeSecret', () => {
    it('writes the secret under the user-scoped path and returns the path', async () => {
      const path = await service.storeSecret('user-001', 'JBSWY3DPEHPK3PXP');
      expect(path).toBe('platform/mfa-secrets/user-001');
      expect(vault.kvWrite).toHaveBeenCalledWith(
        'kv',
        'platform/mfa-secrets/user-001',
        expect.objectContaining({ secret: 'JBSWY3DPEHPK3PXP', storedAt: expect.any(String) }),
      );
    });

    it('never returns the secret — only the KV path', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const result = await service.storeSecret('user-001', secret);
      expect(result).not.toContain(secret);
    });

    it('wraps Vault failures in KEY_BACKEND_UNAVAILABLE', async () => {
      vault = makeVault({
        kvWrite: vi.fn().mockRejectedValue(new Error('connection refused')),
      });
      service = new MfaSecretVaultService(vault);
      await expect(service.storeSecret('user-001', 'ABC')).rejects.toMatchObject({
        code: ErrorCode.KEY_BACKEND_UNAVAILABLE,
      });
    });
  });

  describe('retrieveSecret', () => {
    it('reads from the given path and returns the secret string', async () => {
      vault = makeVault({
        kvRead: vi.fn().mockResolvedValue({ secret: 'JBSWY3DPEHPK3PXP', storedAt: 'x' }),
      });
      service = new MfaSecretVaultService(vault);
      const secret = await service.retrieveSecret('platform/mfa-secrets/user-001');
      expect(secret).toBe('JBSWY3DPEHPK3PXP');
    });

    it('refuses a path outside the platform/mfa-secrets/ prefix (fails closed)', async () => {
      await expect(service.retrieveSecret('platform/keys/user-001')).rejects.toMatchObject({
        code: ErrorCode.KEY_FINGERPRINT_MISMATCH,
      });
    });

    it('refuses an empty secretRef', async () => {
      await expect(service.retrieveSecret('')).rejects.toMatchObject({
        code: ErrorCode.KEY_FINGERPRINT_MISMATCH,
      });
    });

    it('wraps Vault failures in KEY_BACKEND_UNAVAILABLE', async () => {
      vault = makeVault({
        kvRead: vi.fn().mockRejectedValue(new Error('not found')),
      });
      service = new MfaSecretVaultService(vault);
      await expect(
        service.retrieveSecret('platform/mfa-secrets/user-001'),
      ).rejects.toMatchObject({ code: ErrorCode.KEY_BACKEND_UNAVAILABLE });
    });
  });

  describe('destroySecret', () => {
    it('calls kvDestroyAllVersions at the correct path', async () => {
      await service.destroySecret('platform/mfa-secrets/user-001');
      expect(vault.kvDestroyAllVersions).toHaveBeenCalledWith(
        'kv',
        'platform/mfa-secrets/user-001',
      );
    });

    it('refuses a path outside the platform/mfa-secrets/ prefix', async () => {
      await expect(service.destroySecret('platform/keys/user-001')).rejects.toMatchObject({
        code: ErrorCode.KEY_FINGERPRINT_MISMATCH,
      });
    });
  });
});
