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
});
