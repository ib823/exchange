import { describe, it, expect } from 'vitest';
import { SepError, isSepError } from './SepError';
import { ErrorCode } from './ErrorCode';

describe('SepError', () => {
  it('constructs with code and default message', () => {
    const err = new SepError(ErrorCode.CRYPTO_KEY_EXPIRED);
    expect(err.code).toBe(ErrorCode.CRYPTO_KEY_EXPIRED);
    expect(err.message).toContain('expired');
    expect(err instanceof Error).toBe(true);
    expect(err instanceof SepError).toBe(true);
  });

  it('marks terminal errors correctly', () => {
    const terminal = new SepError(ErrorCode.CRYPTO_VERIFICATION_FAILED);
    expect(terminal.terminal).toBe(true);
    expect(terminal.retryable).toBe(false);
  });

  it('marks retryable errors correctly', () => {
    const retryable = new SepError(ErrorCode.TRANSPORT_CONNECTION_FAILED);
    expect(retryable.retryable).toBe(true);
    expect(retryable.terminal).toBe(false);
  });

  it('toClientJson does not expose internal context', () => {
    const err = new SepError(ErrorCode.DATABASE_ERROR, {
      tenantId: 'tenant-123',
      operation: 'query',
      correlationId: 'corr-abc',
    });
    const json = err.toClientJson();
    expect(json.correlationId).toBe('corr-abc');
    expect('context' in json).toBe(false);
    expect(JSON.stringify(json)).not.toContain('operation');
    expect(JSON.stringify(json)).not.toContain('query');
  });

  it('toLogJson includes context for internal logging', () => {
    const err = new SepError(ErrorCode.DATABASE_ERROR, { tenantId: 'tenant-123' });
    const json = err.toLogJson();
    expect(json.context.tenantId).toBe('tenant-123');
  });

  it('context is frozen (immutable)', () => {
    const err = new SepError(ErrorCode.INTERNAL_ERROR, { tenantId: 'abc' });
    expect(Object.isFrozen(err.context)).toBe(true);
  });

  it('isSepError returns true for SepError', () => {
    expect(isSepError(new SepError(ErrorCode.INTERNAL_ERROR))).toBe(true);
  });

  it('isSepError returns false for generic Error', () => {
    expect(isSepError(new Error('oops'))).toBe(false);
    expect(isSepError('string')).toBe(false);
    expect(isSepError(null)).toBe(false);
  });

  it('accepts custom message', () => {
    const err = new SepError(ErrorCode.INTERNAL_ERROR, {}, 'Custom message');
    expect(err.message).toBe('Custom message');
  });
});
