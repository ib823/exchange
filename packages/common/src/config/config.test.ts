/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/explicit-function-return-type */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { _resetConfigForTest, getConfig } from './config';

// Save and restore env vars
const savedEnv: Record<string, string | undefined> = {};
const envVarsToSet: string[] = [];

function setEnv(key: string, value: string) {
  savedEnv[key] = process.env[key];
  process.env[key] = value;
  envVarsToSet.push(key);
}

function setRequiredEnv() {
  // Minimum required env vars for config validation
  setEnv('DATABASE_URL', 'postgresql://test:test@localhost:5432/test');
  setEnv('REDIS_URL', 'redis://localhost:6379');
  setEnv('STORAGE_ENDPOINT', 'http://localhost:9000');
  setEnv('STORAGE_ACCESS_KEY', 'minioadmin');
  setEnv('STORAGE_SECRET_KEY', 'minioadmin');
  setEnv('STORAGE_BUCKET_PAYLOADS', 'sep-payloads');
  setEnv('STORAGE_BUCKET_AUDIT_EXPORTS', 'sep-audit-exports');
  setEnv('VAULT_ADDR', 'http://localhost:8200');
  setEnv('VAULT_TOKEN', 'dev-root-token-for-testing-only');
  setEnv('JWT_SECRET', 'test-jwt-secret-at-least-32-characters-long');
  setEnv('REFRESH_TOKEN_SECRET', 'test-refresh-secret-at-least-32-chars');
  setEnv('INTERNAL_SERVICE_TOKEN', 'test-internal-service-token-32chars-min');
  setEnv('WEBHOOK_SIGNING_SECRET', 'test-webhook-signing-secret-32chars-min');
  setEnv('AUDIT_HASH_SECRET', 'test-audit-hash-secret-at-least-32chars');
}

describe('Config — malware scan variable naming', () => {
  beforeEach(() => {
    _resetConfigForTest();
  });

  afterEach(() => {
    // Restore all env vars
    for (const key of envVarsToSet) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    envVarsToSet.length = 0;
    _resetConfigForTest();
  });

  it('reads MALWARE_SCAN_ENABLED (documented name) and enables the gate', () => {
    setRequiredEnv();
    setEnv('MALWARE_SCAN_ENABLED', 'true');

    const config = getConfig();
    expect(config.features.malwareScanEnabled).toBe(true);
  });

  it('reads FEATURE_MALWARE_SCAN_ENABLED (legacy name) as fallback', () => {
    setRequiredEnv();
    setEnv('FEATURE_MALWARE_SCAN_ENABLED', 'true');

    const config = getConfig();
    expect(config.features.malwareScanEnabled).toBe(true);
  });

  it('documented name takes precedence over legacy name', () => {
    setRequiredEnv();
    setEnv('MALWARE_SCAN_ENABLED', 'true');
    setEnv('FEATURE_MALWARE_SCAN_ENABLED', 'false');

    const config = getConfig();
    expect(config.features.malwareScanEnabled).toBe(true);
  });

  it('defaults to false when neither variable is set', () => {
    setRequiredEnv();

    const config = getConfig();
    expect(config.features.malwareScanEnabled).toBe(false);
  });
});
