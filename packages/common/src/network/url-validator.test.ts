import { describe, it, expect } from 'vitest';
import { validateOutboundUrl, assertOutboundUrlSafe } from './url-validator';

describe('validateOutboundUrl', () => {
  // ── Valid URLs ──────────────────────────────────────────────────────────────
  it('accepts a public HTTPS URL', () => {
    expect(validateOutboundUrl('https://webhook.example.com/events')).toEqual({ valid: true });
  });

  it('accepts a public HTTP URL', () => {
    expect(validateOutboundUrl('http://webhook.example.com/events')).toEqual({ valid: true });
  });

  // ── Loopback / localhost ───────────────────────────────────────────────────
  it('rejects 127.0.0.1', () => {
    const result = validateOutboundUrl('https://127.0.0.1/metadata');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Private/reserved IPv4');
  });

  it('rejects 127.0.0.2 (any 127.x.x.x)', () => {
    expect(validateOutboundUrl('https://127.0.0.2:8080/test').valid).toBe(false);
  });

  it('rejects localhost by hostname', () => {
    const result = validateOutboundUrl('https://localhost/api');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Blocked hostname');
  });

  // ── Cloud metadata endpoints ───────────────────────────────────────────────
  it('rejects 169.254.169.254 (AWS/GCP/Azure metadata)', () => {
    const result = validateOutboundUrl('http://169.254.169.254/latest/meta-data/');
    expect(result.valid).toBe(false);
  });

  it('rejects 169.254.170.2 (AWS ECS metadata)', () => {
    expect(validateOutboundUrl('http://169.254.170.2/v3/').valid).toBe(false);
  });

  it('rejects metadata.google.internal', () => {
    const result = validateOutboundUrl('http://metadata.google.internal/computeMetadata/v1/');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Blocked hostname');
  });

  // ── Private RFC 1918 ranges ────────────────────────────────────────────────
  it('rejects 10.0.0.1 (10.x private range)', () => {
    const result = validateOutboundUrl('https://10.0.0.1/internal-api');
    expect(result.valid).toBe(false);
  });

  it('rejects 192.168.1.1 (192.168.x private range)', () => {
    expect(validateOutboundUrl('https://192.168.1.1/api').valid).toBe(false);
  });

  it('rejects 172.16.0.1 (172.16-31.x private range)', () => {
    expect(validateOutboundUrl('https://172.16.0.1/service').valid).toBe(false);
  });

  it('rejects 172.31.255.255 (upper bound of 172.16-31.x)', () => {
    expect(validateOutboundUrl('https://172.31.255.255/').valid).toBe(false);
  });

  // ── IPv6 addresses ─────────────────────────────────────────────────────────
  it('rejects ::1 (IPv6 loopback)', () => {
    expect(validateOutboundUrl('https://[::1]/api').valid).toBe(false);
  });

  it('rejects fe80:: (IPv6 link-local)', () => {
    expect(validateOutboundUrl('https://[fe80::1]/api').valid).toBe(false);
  });

  it('rejects fc00:: (IPv6 unique local)', () => {
    expect(validateOutboundUrl('https://[fc00::1]/api').valid).toBe(false);
  });

  // ── Protocol restrictions ──────────────────────────────────────────────────
  it('rejects ftp:// protocol', () => {
    const result = validateOutboundUrl('ftp://evil.com/file');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Unsupported protocol');
  });

  it('rejects file:// protocol', () => {
    expect(validateOutboundUrl('file:///etc/passwd').valid).toBe(false);
  });

  // ── Malformed URLs ─────────────────────────────────────────────────────────
  it('rejects malformed URLs', () => {
    const result = validateOutboundUrl('not-a-url');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Malformed');
  });

  // ── Embedded credentials ───────────────────────────────────────────────────
  it('rejects URLs with embedded credentials', () => {
    const result = validateOutboundUrl('https://user:pass@example.com/webhook');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('credentials');
  });

  // ── Kubernetes internal hostnames ──────────────────────────────────────────
  it('rejects kubernetes.default.svc.cluster.local', () => {
    expect(validateOutboundUrl('https://kubernetes.default.svc.cluster.local/api').valid).toBe(
      false,
    );
  });
});

describe('assertOutboundUrlSafe', () => {
  it('does not throw for valid public URL', () => {
    expect(() => assertOutboundUrlSafe('https://hooks.example.com/events')).not.toThrow();
  });

  it('throws SepError with VALIDATION_SCHEMA_FAILED for private IP', () => {
    expect(() => assertOutboundUrlSafe('https://127.0.0.1/hook')).toThrow(
      'VALIDATION_SCHEMA_FAILED',
    );
  });

  it('throws SepError with VALIDATION_SCHEMA_FAILED for metadata endpoint', () => {
    expect(() => assertOutboundUrlSafe('http://169.254.169.254/latest')).toThrow(
      'VALIDATION_SCHEMA_FAILED',
    );
  });
});
