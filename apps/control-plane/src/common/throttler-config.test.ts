import { describe, it, expect } from 'vitest';
import { loginEmailTracker, mfaChallengeTracker } from './throttler-config';

describe('loginEmailTracker', () => {
  it('normalises email (lowercase + trim) and keys by (ip, email)', () => {
    const key = loginEmailTracker({
      ip: '10.0.0.1',
      body: { email: '  User@Example.com  ' },
    });
    expect(key).toBe('10.0.0.1|user@example.com');
  });

  it('falls back to <no-email> bucket when email is missing', () => {
    expect(loginEmailTracker({ ip: '10.0.0.1', body: {} })).toBe('10.0.0.1|<no-email>');
    expect(loginEmailTracker({ ip: '10.0.0.1' })).toBe('10.0.0.1|<no-email>');
  });

  it('falls back to <no-email> bucket when email is empty / whitespace', () => {
    expect(loginEmailTracker({ ip: '10.0.0.1', body: { email: '' } })).toBe('10.0.0.1|<no-email>');
    expect(loginEmailTracker({ ip: '10.0.0.1', body: { email: '   ' } })).toBe(
      '10.0.0.1|<no-email>',
    );
  });

  it('falls back to <no-email> bucket when email is non-string', () => {
    expect(loginEmailTracker({ ip: '10.0.0.1', body: { email: 123 } })).toBe('10.0.0.1|<no-email>');
    expect(loginEmailTracker({ ip: '10.0.0.1', body: { email: null } })).toBe(
      '10.0.0.1|<no-email>',
    );
    expect(loginEmailTracker({ ip: '10.0.0.1', body: { email: { nested: 'obj' } } })).toBe(
      '10.0.0.1|<no-email>',
    );
  });

  it('never throws — malformed body object also falls back', () => {
    expect(() => loginEmailTracker({ ip: '10.0.0.1', body: null })).not.toThrow();
    expect(() => loginEmailTracker({ ip: '10.0.0.1', body: 'string-body' })).not.toThrow();
    expect(() => loginEmailTracker({})).not.toThrow();
  });

  it('uses unknown-ip marker when req.ip is missing/empty so the key is still stable', () => {
    expect(loginEmailTracker({ body: { email: 'a@b.c' } })).toBe('unknown-ip|a@b.c');
    expect(loginEmailTracker({ ip: '', body: { email: 'a@b.c' } })).toBe('unknown-ip|a@b.c');
  });

  // Load-bearing: attacker-with-missing-email cannot evade the per-IP
  // bucket by spamming different shapes that collapse to different
  // keys. All missing-email shapes from the same IP share ONE bucket.
  it('all fallback shapes from the same IP collapse to identical key (no bucket-hopping)', () => {
    const ip = '10.0.0.99';
    const keys = [
      loginEmailTracker({ ip }),
      loginEmailTracker({ ip, body: {} }),
      loginEmailTracker({ ip, body: { email: '' } }),
      loginEmailTracker({ ip, body: { email: '   ' } }),
      loginEmailTracker({ ip, body: { email: null } }),
      loginEmailTracker({ ip, body: { email: 42 } }),
      loginEmailTracker({ ip, body: null }),
    ];
    const unique = new Set(keys);
    expect(unique.size).toBe(1);
    expect([...unique][0]).toBe(`${ip}|<no-email>`);
  });
});

describe('mfaChallengeTracker', () => {
  it('keys by challenge-token prefix', () => {
    const key = mfaChallengeTracker({
      ip: '10.0.0.1',
      body: { challengeToken: 'jwt-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-rest-of-token-is-ignored' },
    });
    expect(key).toMatch(/^challenge\|/);
    expect(key.length).toBeLessThan(60); // slice(0, 32) on the token
  });

  it('falls back to IP bucket when challengeToken is missing/non-string/empty', () => {
    const ip = '10.0.0.1';
    expect(mfaChallengeTracker({ ip, body: {} })).toBe(`${ip}|<no-challenge>`);
    expect(mfaChallengeTracker({ ip })).toBe(`${ip}|<no-challenge>`);
    expect(mfaChallengeTracker({ ip, body: { challengeToken: '' } })).toBe(`${ip}|<no-challenge>`);
    expect(mfaChallengeTracker({ ip, body: { challengeToken: 42 } })).toBe(`${ip}|<no-challenge>`);
  });

  it('never throws', () => {
    expect(() => mfaChallengeTracker({})).not.toThrow();
    expect(() => mfaChallengeTracker({ body: null })).not.toThrow();
  });
});
