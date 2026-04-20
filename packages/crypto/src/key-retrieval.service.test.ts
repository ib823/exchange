/* eslint-disable @typescript-eslint/unbound-method --
 * Mock backend is a vi.fn()-typed IKeyCustodyBackend; the
 * expect(backend.method) idiom fires the unbound-method rule with no
 * actual runtime hazard. */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import * as openpgp from 'openpgp';
import { ErrorCode, SepError } from '@sep/common';
import { KeyRetrievalService, type KeyReferenceRow } from './key-retrieval.service';
import { KeyCustodyAbstraction } from './custody/key-custody-abstraction';
import type { ArmoredKey, IKeyCustodyBackend } from './custody/i-key-custody-backend';

vi.mock('@sep/observability', () => ({
  createLogger: (): unknown => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Two fixture keypairs — primary (matches the DB row) and substituted
// (used in fingerprint-mismatch and algorithm-mismatch scenarios).
interface Fixture {
  armoredPublicKey: string;
  fingerprint: string;
  algorithm: string;
}
let rsa: Fixture;
let ecc: Fixture;

async function generateFixture(type: 'rsa' | 'ecc', userLabel: string): Promise<Fixture> {
  const generated =
    type === 'rsa'
      ? await openpgp.generateKey({
          type: 'rsa',
          rsaBits: 2048,
          userIDs: [{ name: userLabel, email: `${userLabel}@fixture.invalid` }],
          format: 'armored',
        })
      : await openpgp.generateKey({
          type: 'ecc',
          curve: 'curve25519',
          userIDs: [{ name: userLabel, email: `${userLabel}@fixture.invalid` }],
          format: 'armored',
        });
  const pub = await openpgp.readKey({ armoredKey: generated.publicKey });
  const algInfo = pub.getAlgorithmInfo();
  return {
    armoredPublicKey: generated.publicKey,
    fingerprint: pub.getFingerprint(),
    algorithm: algInfo.algorithm.toLowerCase(),
  };
}

beforeAll(async () => {
  rsa = await generateFixture('rsa', 'primary');
  ecc = await generateFixture('ecc', 'secondary');
}, 60_000);

function makeRow(overrides: Partial<KeyReferenceRow> = {}): KeyReferenceRow {
  return {
    id: 'key-001',
    tenantId: 'tenant-001',
    partnerProfileId: 'profile-001',
    name: 'test-key',
    usage: ['ENCRYPT', 'DECRYPT'],
    backendType: 'PLATFORM_VAULT',
    backendRef: 'platform/keys/key-001',
    fingerprint: rsa.fingerprint,
    algorithm: 'rsa',
    version: 1,
    state: 'ACTIVE',
    environment: 'TEST',
    activatedAt: new Date('2026-01-01'),
    expiresAt: new Date(Date.now() + 86_400_000),
    revokedAt: null,
    ...overrides,
  };
}

/**
 * Construct a KeyCustodyAbstraction whose backends all resolve to the
 * same mock; the mock's getPublicKey returns the armored key provided,
 * or throws if configured to.
 */
function makeCustody(getPublicKey: IKeyCustodyBackend['getPublicKey']): {
  custody: KeyCustodyAbstraction;
  backend: IKeyCustodyBackend;
} {
  const backend: IKeyCustodyBackend = {
    getPublicKey,
    signDetached: vi.fn(),
    signInline: vi.fn(),
    verifyDetached: vi.fn(),
    decrypt: vi.fn(),
    encryptForRecipient: vi.fn(),
    signAndEncrypt: vi.fn(),
    decryptAndVerify: vi.fn(),
    rotate: vi.fn(),
    revoke: vi.fn(),
  };
  const custody = new KeyCustodyAbstraction({
    platformVault: backend,
    tenantVaultFactory: (): IKeyCustodyBackend => backend,
    externalKms: backend,
    softwareLocal: backend,
  });
  return { custody, backend };
}

describe('KeyRetrievalService', () => {
  let service: KeyRetrievalService;

  beforeEach(() => {
    const { custody } = makeCustody(
      vi.fn((): Promise<ArmoredKey> => Promise.resolve(rsa.armoredPublicKey as ArmoredKey)),
    );
    service = new KeyRetrievalService(custody);
  });

  it('resolves an ACTIVE key with matching fingerprint and algorithm', async () => {
    const result = await service.resolveKey(makeRow(), 'TEST');
    expect(result.keyRef.keyReferenceId).toBe('key-001');
    expect(result.keyRef.state).toBe('ACTIVE');
    expect(result.armoredKey).toContain('PGP PUBLIC KEY BLOCK');
    expect(result.fingerprint).toBe(rsa.fingerprint);
  });

  it('rejects EXPIRED state with CRYPTO_KEY_EXPIRED (no backend call)', async () => {
    await expect(service.resolveKey(makeRow({ state: 'EXPIRED' }), 'TEST')).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.CRYPTO_KEY_EXPIRED }) as unknown as Error,
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
      expect.objectContaining({ code: ErrorCode.CRYPTO_KEY_INVALID_STATE }) as unknown as Error,
    );
  });

  it('rejects environment mismatch with POLICY_ENVIRONMENT_MISMATCH', async () => {
    await expect(
      service.resolveKey(makeRow({ environment: 'PRODUCTION' }), 'TEST'),
    ).rejects.toThrow(
      expect.objectContaining({
        code: ErrorCode.POLICY_ENVIRONMENT_MISMATCH,
      }) as unknown as Error,
    );
  });

  it('rejects expired key (past expiresAt) with CRYPTO_KEY_EXPIRED', async () => {
    const row = makeRow({ expiresAt: new Date(Date.now() - 1000) });
    await expect(service.resolveKey(row, 'TEST')).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.CRYPTO_KEY_EXPIRED }) as unknown as Error,
    );
  });

  it('rejects fingerprint mismatch with KEY_FINGERPRINT_MISMATCH (backend returns a different key)', async () => {
    // Backend returns an ECC key whose fingerprint differs from the
    // DB row's RSA fingerprint. KeyRetrievalService must catch the
    // mismatch after parsing the armored material.
    const { custody } = makeCustody(
      vi.fn((): Promise<ArmoredKey> => Promise.resolve(ecc.armoredPublicKey as ArmoredKey)),
    );
    service = new KeyRetrievalService(custody);
    await expect(service.resolveKey(makeRow(), 'TEST')).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.KEY_FINGERPRINT_MISMATCH }) as unknown as Error,
    );
  });

  it('rejects algorithm mismatch with KEY_FINGERPRINT_MISMATCH', async () => {
    // Row claims algorithm='ecdh' but fingerprint matches the RSA
    // fixture. KeyRetrievalService's algorithm check surfaces the
    // inconsistency.
    const row = makeRow({ algorithm: 'ecdh' });
    await expect(service.resolveKey(row, 'TEST')).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.KEY_FINGERPRINT_MISMATCH }) as unknown as Error,
    );
  });

  it('throws KEY_BACKEND_UNAVAILABLE when the backend fails with a generic error', async () => {
    const { custody } = makeCustody(
      vi.fn((): Promise<ArmoredKey> => Promise.reject(new Error('connection refused'))),
    );
    service = new KeyRetrievalService(custody);
    await expect(service.resolveKey(makeRow(), 'TEST')).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.KEY_BACKEND_UNAVAILABLE }) as unknown as Error,
    );
  });

  it('passes through a SepError thrown by the backend unchanged', async () => {
    const { custody } = makeCustody(
      vi.fn(
        (): Promise<ArmoredKey> =>
          Promise.reject(new SepError(ErrorCode.CRYPTO_KEY_NOT_FOUND, { keyReferenceId: 'k' })),
      ),
    );
    service = new KeyRetrievalService(custody);
    await expect(service.resolveKey(makeRow(), 'TEST')).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.CRYPTO_KEY_NOT_FOUND }) as unknown as Error,
    );
  });

  it('accepts key with null expiresAt (no expiry)', async () => {
    const result = await service.resolveKey(makeRow({ expiresAt: null }), 'TEST');
    expect(result.keyRef.expiresAt).toBeNull();
  });
});
