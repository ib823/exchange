/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/explicit-function-return-type */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorCode } from '@sep/common';
import { KeyRetrievalService, type KeyReferenceRow } from './key-retrieval.service';
import type { IKeyMaterialProvider, KeyMaterial } from './key-material-provider';

vi.mock('@sep/observability', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function makeRow(overrides: Partial<KeyReferenceRow> = {}): KeyReferenceRow {
  return {
    id: 'key-001',
    tenantId: 'tenant-001',
    partnerProfileId: 'profile-001',
    name: 'test-key',
    usage: ['ENCRYPT', 'DECRYPT'],
    backendType: 'PLATFORM_VAULT',
    backendRef: 'secret/sep/keys/test-key',
    fingerprint: 'AABB1122CCDD3344',
    algorithm: 'rsa',
    version: 1,
    state: 'ACTIVE',
    environment: 'TEST',
    activatedAt: new Date('2026-01-01'),
    expiresAt: new Date(Date.now() + 86400000), // tomorrow
    revokedAt: null,
    ...overrides,
  };
}

function makeMaterial(overrides: Partial<KeyMaterial> = {}): KeyMaterial {
  return {
    armoredKey: '-----BEGIN PGP PUBLIC KEY BLOCK-----\ntest\n-----END PGP PUBLIC KEY BLOCK-----',
    fingerprint: 'AABB1122CCDD3344',
    algorithm: 'rsa',
    bitLength: 4096,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeProvider(material?: KeyMaterial): IKeyMaterialProvider {
  return {
    loadKeyMaterial: vi.fn().mockResolvedValue(material ?? makeMaterial()),
  };
}

describe('KeyRetrievalService', () => {
  let service: KeyRetrievalService;
  let provider: IKeyMaterialProvider;

  beforeEach(() => {
    provider = makeProvider();
    service = new KeyRetrievalService(provider);
  });

  it('resolves an ACTIVE key with matching fingerprint', async () => {
    const result = await service.resolveKey(makeRow(), 'TEST');
    expect(result.keyRef.keyReferenceId).toBe('key-001');
    expect(result.keyRef.state).toBe('ACTIVE');
    expect(result.armoredKey).toContain('PGP PUBLIC KEY BLOCK');
    expect(result.fingerprint).toBe('AABB1122CCDD3344');
  });

  it('rejects EXPIRED state with CRYPTO_KEY_EXPIRED', async () => {
    await expect(service.resolveKey(makeRow({ state: 'EXPIRED' }), 'TEST')).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.CRYPTO_KEY_EXPIRED }),
    );
  });

  it.each([
    'DRAFT',
    'IMPORTED',
    'VALIDATED',
    'ROTATING',
    'SUSPENDED',
    'COMPROMISED',
    'REVOKED',
    'RETIRED',
    'DESTROYED',
  ])('rejects %s state with CRYPTO_KEY_INVALID_STATE', async (state) => {
    await expect(service.resolveKey(makeRow({ state }), 'TEST')).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.CRYPTO_KEY_INVALID_STATE }),
    );
  });

  it('rejects environment mismatch with POLICY_ENVIRONMENT_MISMATCH', async () => {
    await expect(
      service.resolveKey(makeRow({ environment: 'PRODUCTION' }), 'TEST'),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.POLICY_ENVIRONMENT_MISMATCH }));
  });

  it('rejects expired key (past expiresAt) with CRYPTO_KEY_EXPIRED', async () => {
    const row = makeRow({ expiresAt: new Date(Date.now() - 1000) });
    await expect(service.resolveKey(row, 'TEST')).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.CRYPTO_KEY_EXPIRED }),
    );
  });

  it('rejects fingerprint mismatch with KEY_FINGERPRINT_MISMATCH', async () => {
    provider = makeProvider(makeMaterial({ fingerprint: 'DIFFERENT_FP' }));
    service = new KeyRetrievalService(provider);
    await expect(service.resolveKey(makeRow(), 'TEST')).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.KEY_FINGERPRINT_MISMATCH }),
    );
  });

  it('rejects algorithm mismatch with KEY_FINGERPRINT_MISMATCH', async () => {
    provider = makeProvider(makeMaterial({ algorithm: 'ecdh' }));
    service = new KeyRetrievalService(provider);
    await expect(service.resolveKey(makeRow(), 'TEST')).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.KEY_FINGERPRINT_MISMATCH }),
    );
  });

  it('throws KEY_BACKEND_UNAVAILABLE when provider fails', async () => {
    provider = { loadKeyMaterial: vi.fn().mockRejectedValue(new Error('connection refused')) };
    service = new KeyRetrievalService(provider);
    await expect(service.resolveKey(makeRow(), 'TEST')).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.KEY_BACKEND_UNAVAILABLE }),
    );
  });

  it('passes through SepError from provider', async () => {
    const { SepError: SE } = await import('@sep/common');
    provider = {
      loadKeyMaterial: vi.fn().mockRejectedValue(new SE(ErrorCode.CRYPTO_KEY_NOT_FOUND)),
    };
    service = new KeyRetrievalService(provider);
    await expect(service.resolveKey(makeRow(), 'TEST')).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.CRYPTO_KEY_NOT_FOUND }),
    );
  });

  it('accepts key with null expiresAt (no expiry)', async () => {
    const result = await service.resolveKey(makeRow({ expiresAt: null }), 'TEST');
    expect(result.keyRef.expiresAt).toBeNull();
  });
});
