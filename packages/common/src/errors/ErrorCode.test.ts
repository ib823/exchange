import { describe, it, expect } from 'vitest';
import { ErrorCode, TERMINAL_ERROR_CODES, RETRYABLE_ERROR_CODES } from './ErrorCode';

describe('ErrorCode', () => {
  it('has no code in both terminal and retryable sets', () => {
    for (const code of TERMINAL_ERROR_CODES) {
      expect(RETRYABLE_ERROR_CODES.has(code)).toBe(false);
    }
  });

  it('CRYPTO_VERIFICATION_FAILED is terminal', () => {
    expect(TERMINAL_ERROR_CODES.has(ErrorCode.CRYPTO_VERIFICATION_FAILED)).toBe(true);
  });

  it('TRANSPORT_CONNECTION_FAILED is retryable', () => {
    expect(RETRYABLE_ERROR_CODES.has(ErrorCode.TRANSPORT_CONNECTION_FAILED)).toBe(true);
    expect(TERMINAL_ERROR_CODES.has(ErrorCode.TRANSPORT_CONNECTION_FAILED)).toBe(false);
  });

  it('TENANT_BOUNDARY_VIOLATION is terminal and not retryable', () => {
    expect(TERMINAL_ERROR_CODES.has(ErrorCode.TENANT_BOUNDARY_VIOLATION)).toBe(true);
    expect(RETRYABLE_ERROR_CODES.has(ErrorCode.TENANT_BOUNDARY_VIOLATION)).toBe(false);
  });

  it('all ErrorCode values are strings', () => {
    for (const value of Object.values(ErrorCode)) {
      expect(typeof value).toBe('string');
    }
  });
});
