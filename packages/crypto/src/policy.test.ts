import { describe, it, expect } from 'vitest';
import { enforcePolicy } from './policy';
import { DEFAULT_ALGORITHM_POLICY, type KeyRef } from './interfaces';
import { ErrorCode } from '@sep/common';

function makeKeyRef(overrides: Partial<KeyRef> = {}): KeyRef {
  return {
    keyReferenceId: 'key-001',
    backendRef: 'secret/sep/keys/key-001',
    algorithm: 'rsa4096',
    state: 'ACTIVE',
    allowedUsages: ['ENCRYPT', 'DECRYPT', 'SIGN', 'VERIFY'],
    revokedAt: null,
    expiresAt: new Date(Date.now() + 86_400_000),
    environment: 'TEST',
    ...overrides,
  };
}

describe('enforcePolicy', () => {
  it('passes for a valid key and allowed algorithm', () => {
    expect(() =>
      enforcePolicy(DEFAULT_ALGORITHM_POLICY, makeKeyRef(), 'rsa', 'ENCRYPT', 'TEST', 'aes256', 'sha256'),
    ).not.toThrow();
  });

  it('throws CRYPTO_KEY_EXPIRED for an expired key', () => {
    const expiredKey = makeKeyRef({ expiresAt: new Date(Date.now() - 1000) });
    expect(() =>
      enforcePolicy(DEFAULT_ALGORITHM_POLICY, expiredKey, 'rsa', 'ENCRYPT', 'TEST'),
    ).toThrowError(expect.objectContaining({ code: ErrorCode.CRYPTO_KEY_EXPIRED }) as Error);
  });

  it('throws CRYPTO_KEY_EXPIRED for a key with expiresAt == now (boundary)', () => {
    const justExpired = makeKeyRef({ expiresAt: new Date(Date.now() - 1) });
    expect(() =>
      enforcePolicy(DEFAULT_ALGORITHM_POLICY, justExpired, 'rsa', 'ENCRYPT', 'TEST'),
    ).toThrowError(expect.objectContaining({ code: ErrorCode.CRYPTO_KEY_EXPIRED }) as Error);
  });

  it('throws CRYPTO_POLICY_VIOLATION for disallowed algorithm', () => {
    expect(() =>
      enforcePolicy(DEFAULT_ALGORITHM_POLICY, makeKeyRef(), 'dsa', 'ENCRYPT', 'TEST'),
    ).toThrowError(expect.objectContaining({ code: ErrorCode.CRYPTO_UNSUPPORTED_ALGORITHM }) as Error);
  });

  it('throws CRYPTO_POLICY_VIOLATION for disallowed cipher', () => {
    expect(() =>
      enforcePolicy(DEFAULT_ALGORITHM_POLICY, makeKeyRef(), 'rsa', 'ENCRYPT', 'TEST', 'des3'),
    ).toThrowError(expect.objectContaining({ code: ErrorCode.CRYPTO_POLICY_VIOLATION }) as Error);
  });

  it('throws CRYPTO_POLICY_VIOLATION for disallowed hash', () => {
    expect(() =>
      enforcePolicy(DEFAULT_ALGORITHM_POLICY, makeKeyRef(), 'rsa', 'ENCRYPT', 'TEST', 'aes256', 'md5'),
    ).toThrowError(expect.objectContaining({ code: ErrorCode.CRYPTO_POLICY_VIOLATION }) as Error);
  });

  it('does not throw for null expiresAt (no expiry set)', () => {
    const noExpiry = makeKeyRef({ expiresAt: null });
    expect(() =>
      enforcePolicy(DEFAULT_ALGORITHM_POLICY, noExpiry, 'rsa', 'ENCRYPT', 'TEST', 'aes256', 'sha256'),
    ).not.toThrow();
  });

  it('expired key error is terminal and not retryable', () => {
    const expiredKey = makeKeyRef({ expiresAt: new Date(Date.now() - 1000) });
    try {
      enforcePolicy(DEFAULT_ALGORITHM_POLICY, expiredKey, 'rsa', 'ENCRYPT', 'TEST');
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as { terminal: boolean }).terminal).toBe(true);
      expect((err as { retryable: boolean }).retryable).toBe(false);
    }
  });

  it('throws CRYPTO_KEY_INVALID_STATE for non-ACTIVE key', () => {
    const drafted = makeKeyRef({ state: 'DRAFT' });
    expect(() => enforcePolicy(DEFAULT_ALGORITHM_POLICY, drafted, 'rsa', 'ENCRYPT', 'TEST'))
      .toThrowError(expect.objectContaining({ code: ErrorCode.CRYPTO_KEY_INVALID_STATE }) as Error);
  });

  it('throws CRYPTO_KEY_INVALID_STATE for revoked key', () => {
    const revoked = makeKeyRef({ state: 'ACTIVE', revokedAt: new Date(Date.now() - 1000) });
    expect(() => enforcePolicy(DEFAULT_ALGORITHM_POLICY, revoked, 'rsa', 'ENCRYPT', 'TEST'))
      .toThrowError(expect.objectContaining({ code: ErrorCode.CRYPTO_KEY_INVALID_STATE }) as Error);
  });

  it('throws POLICY_ENVIRONMENT_MISMATCH for wrong environment', () => {
    const testKey = makeKeyRef({ state: 'ACTIVE', environment: 'TEST' });
    expect(() => enforcePolicy(DEFAULT_ALGORITHM_POLICY, testKey, 'rsa', 'ENCRYPT', 'PRODUCTION'))
      .toThrowError(expect.objectContaining({ code: ErrorCode.POLICY_ENVIRONMENT_MISMATCH }) as Error);
  });

  it('throws CRYPTO_POLICY_VIOLATION for wrong usage', () => {
    const encryptOnly = makeKeyRef({ state: 'ACTIVE', allowedUsages: ['ENCRYPT'] });
    expect(() => enforcePolicy(DEFAULT_ALGORITHM_POLICY, encryptOnly, 'rsa', 'SIGN', 'TEST'))
      .toThrowError(expect.objectContaining({ code: ErrorCode.CRYPTO_POLICY_VIOLATION }) as Error);
  });
});
