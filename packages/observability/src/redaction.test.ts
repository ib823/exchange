import { describe, it, expect } from 'vitest';
import { REDACTED_PATHS, isRedactedField } from './redaction';

const SENSITIVE_FIELD_NAMES = [
  'privateKey',
  'passphrase',
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'secretKey',
  'authorization',
  'Authorization',
  'bearerToken',
  'serviceToken',
  'vaultToken',
  'webhookSecret',
  'signingSecret',
  'keyMaterial',
  'payload',
  'privateKeyArmored',
  'sftpPrivateKey',
  'sftpPassword',
  'hmacSecret',
];

describe('Redaction configuration', () => {
  it('has at least 20 redaction paths', () => {
    expect(REDACTED_PATHS.length).toBeGreaterThanOrEqual(20);
  });

  it.each(SENSITIVE_FIELD_NAMES)('redacts sensitive field: %s', (field) => {
    expect(isRedactedField(field)).toBe(true);
  });

  it('does not redact safe fields', () => {
    const safeFields = ['tenantId', 'submissionId', 'correlationId', 'status', 'createdAt'];
    for (const field of safeFields) {
      expect(isRedactedField(field)).toBe(false);
    }
  });

  it('wildcard paths match nested field names', () => {
    expect(isRedactedField('privateKey')).toBe(true);
    expect(isRedactedField('passphrase')).toBe(true);
    expect(isRedactedField('payload')).toBe(true);
  });

  // Review Item 3 — explicit assertion that Vault auth material is
  // covered by the redaction list. isRedactedField collapses the
  // '*.headers["x-vault-token"]' wildcard to the bare field name for
  // the purpose of the check; here we assert both the top-level and
  // wildcard forms are present in REDACTED_PATHS.
  describe('Vault auth header redaction', () => {
    const vaultAuthPaths = [
      'req.headers["x-vault-token"]',
      'req.headers["x-vault-namespace"]',
      '*.headers.authorization',
      '*.headers["x-vault-token"]',
      '*.headers["x-vault-namespace"]',
      'headers.authorization',
      'headers["x-vault-token"]',
      'headers["x-vault-namespace"]',
    ];
    it.each(vaultAuthPaths)('path "%s" is in REDACTED_PATHS', (path) => {
      expect(REDACTED_PATHS).toContain(path);
    });

    it('covers the bare x-vault-token and vaultToken field names', () => {
      expect(isRedactedField('vaultToken')).toBe(true);
      expect(isRedactedField('VAULT_TOKEN')).toBe(true);
      expect(isRedactedField('authorization')).toBe(true);
    });
  });
});
