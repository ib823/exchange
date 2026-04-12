import { describe, it, expect } from 'vitest';
import { enforcePolicy } from './policy';
import { DEFAULT_ALGORITHM_POLICY, type KeyRef } from './interfaces';
import { ErrorCode } from '@sep/common';

function makeKeyRef(overrides: Partial<KeyRef> = {}): KeyRef {
  return {
    keyReferenceId: 'key-001',
    backendRef: 'secret/sep/keys/key-001',
    algorithm: 'rsa4096',
    expiresAt: new Date(Date.now() + 86_400_000), // 1 day from now
    environment: 'TEST',
    ...overrides,
  };
}

describe('enforcePolicy', () => {
  it('passes for a valid key and allowed algorithm', () => {
    expect(() =>
      enforcePolicy(DEFAULT_ALGORITHM_POLICY, makeKeyRef(), 'rsa', 'aes256', 'sha256'),
    ).not.toThrow();
  });

  it('throws CRYPTO_KEY_EXPIRED for an expired key', () => {
    const expiredKey = makeKeyRef({ expiresAt: new Date(Date.now() - 1000) });
    expect(() =>
      enforcePolicy(DEFAULT_ALGORITHM_POLICY, expiredKey, 'rsa'),
    ).toThrowError(expect.objectContaining({ code: ErrorCode.CRYPTO_KEY_EXPIRED }) as Error);
  });

  it('throws CRYPTO_KEY_EXPIRED for a key with expiresAt == now (boundary)', () => {
    const justExpired = makeKeyRef({ expiresAt: new Date(Date.now() - 1) });
    expect(() =>
      enforcePolicy(DEFAULT_ALGORITHM_POLICY, justExpired, 'rsa'),
    ).toThrowError(expect.objectContaining({ code: ErrorCode.CRYPTO_KEY_EXPIRED }) as Error);
  });

  it('throws CRYPTO_POLICY_VIOLATION for disallowed algorithm', () => {
    expect(() =>
      enforcePolicy(DEFAULT_ALGORITHM_POLICY, makeKeyRef(), 'dsa'),
    ).toThrowError(expect.objectContaining({ code: ErrorCode.CRYPTO_POLICY_VIOLATION }) as Error);
  });

  it('throws CRYPTO_POLICY_VIOLATION for disallowed cipher', () => {
    expect(() =>
      enforcePolicy(DEFAULT_ALGORITHM_POLICY, makeKeyRef(), 'rsa', 'des3'),
    ).toThrowError(expect.objectContaining({ code: ErrorCode.CRYPTO_POLICY_VIOLATION }) as Error);
  });

  it('throws CRYPTO_POLICY_VIOLATION for disallowed hash', () => {
    expect(() =>
      enforcePolicy(DEFAULT_ALGORITHM_POLICY, makeKeyRef(), 'rsa', 'aes256', 'md5'),
    ).toThrowError(expect.objectContaining({ code: ErrorCode.CRYPTO_POLICY_VIOLATION }) as Error);
  });

  it('does not throw for null expiresAt (no expiry set)', () => {
    const noExpiry = makeKeyRef({ expiresAt: null });
    expect(() =>
      enforcePolicy(DEFAULT_ALGORITHM_POLICY, noExpiry, 'rsa', 'aes256', 'sha256'),
    ).not.toThrow();
  });

  it('expired key error is terminal and not retryable', () => {
    const expiredKey = makeKeyRef({ expiresAt: new Date(Date.now() - 1000) });
    try {
      enforcePolicy(DEFAULT_ALGORITHM_POLICY, expiredKey, 'rsa');
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as { terminal: boolean }).terminal).toBe(true);
      expect((err as { retryable: boolean }).retryable).toBe(false);
    }
  });
});
