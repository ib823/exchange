import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';
import { VaultClient, DEFAULT_VAULT_CLIENT_CONFIG, type VaultClientConfig } from './vault-client';
import { ErrorCode } from '@sep/common';

const VAULT_ADDR = 'http://vault.test:8200';

let mockAgent: MockAgent;
let originalDispatcher: Dispatcher;

beforeEach(() => {
  originalDispatcher = getGlobalDispatcher();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
});

afterEach(async () => {
  await mockAgent.close();
  setGlobalDispatcher(originalDispatcher);
});

function makeClient(overrides: Partial<VaultClientConfig> = {}): VaultClient {
  return new VaultClient({
    addr: VAULT_ADDR,
    token: 'dev-root-token',
    ...DEFAULT_VAULT_CLIENT_CONFIG,
    initialBackoffMs: 1,
    ...overrides,
  });
}

describe('VaultClient constructor', () => {
  it('rejects a non-http address', () => {
    let caught: unknown = null;
    try {
      makeClient({ addr: 'vault.example' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toMatchObject({ code: ErrorCode.CONFIGURATION_ERROR });
  });

  it('rejects an empty token', () => {
    let caught: unknown = null;
    try {
      makeClient({ token: '' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toMatchObject({ code: ErrorCode.CONFIGURATION_ERROR });
  });
});

describe('VaultClient KV v2', () => {
  it('writes and reads secret data', async () => {
    const pool = mockAgent.get(VAULT_ADDR);
    let capturedBody: string | null = null;
    let capturedToken: string | null = null;

    pool
      .intercept({
        path: '/v1/kv/data/platform/keys/abc',
        method: 'POST',
      })
      .reply((opts) => {
        capturedBody = typeof opts.body === 'string' ? opts.body : null;
        const headers = opts.headers as Record<string, string> | undefined;
        capturedToken = headers?.['X-Vault-Token'] ?? headers?.['x-vault-token'] ?? null;
        return {
          statusCode: 200,
          data: { data: { version: 2, created_time: '2026-04-19T10:00:00Z' } },
        };
      });

    pool
      .intercept({
        path: '/v1/kv/data/platform/keys/abc',
        method: 'GET',
      })
      .reply(200, {
        data: { data: { armored: 'PGP-DATA' }, metadata: { version: 2 } },
      });

    const client = makeClient();
    const writeResult = await client.kvWrite('kv', 'platform/keys/abc', { armored: 'PGP-DATA' });
    expect(writeResult.data.version).toBe(2);
    expect(capturedBody).not.toBeNull();
    const parsedBody: unknown = JSON.parse((capturedBody as string | null) ?? '{}');
    expect(parsedBody).toEqual({ data: { armored: 'PGP-DATA' } });
    expect(capturedToken).toBe('dev-root-token');

    const readResult = await client.kvRead<{ armored: string }>('kv', 'platform/keys/abc');
    expect(readResult.armored).toBe('PGP-DATA');
    await client.close();
  });

  it('maps 404 to CRYPTO_KEY_NOT_FOUND', async () => {
    const pool = mockAgent.get(VAULT_ADDR);
    pool
      .intercept({ path: '/v1/kv/data/platform/keys/missing', method: 'GET' })
      .reply(404, { errors: ['not found'] });

    const client = makeClient();
    await expect(client.kvRead('kv', 'platform/keys/missing')).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.CRYPTO_KEY_NOT_FOUND }) as unknown as Error,
    );
    await client.close();
  });

  it('maps 403 to KEY_BACKEND_UNAVAILABLE without exposing the token', async () => {
    const pool = mockAgent.get(VAULT_ADDR);
    pool
      .intercept({ path: '/v1/kv/data/platform/keys/denied', method: 'GET' })
      .reply(403, { errors: ['permission denied'] });

    const client = makeClient();
    try {
      await client.kvRead('kv', 'platform/keys/denied');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toMatchObject({ code: ErrorCode.KEY_BACKEND_UNAVAILABLE });
      const serialised = JSON.stringify((err as { context: unknown }).context);
      expect(serialised).not.toContain('dev-root-token');
    }
    await client.close();
  });

  it('retries on 5xx then succeeds', async () => {
    const pool = mockAgent.get(VAULT_ADDR);
    pool.intercept({ path: '/v1/kv/data/a', method: 'POST' }).reply(502, 'bad gateway');
    pool.intercept({ path: '/v1/kv/data/a', method: 'POST' }).reply(200, {
      data: { version: 1, created_time: 'now' },
    });

    const client = makeClient();
    const result = await client.kvWrite('kv', 'a', { armored: 'x' });
    expect(result.data.version).toBe(1);
    await client.close();
  });

  it('throws KEY_BACKEND_UNAVAILABLE after exhausting retries on persistent 5xx', async () => {
    const pool = mockAgent.get(VAULT_ADDR);
    for (let i = 0; i < 4; i++) {
      pool.intercept({ path: '/v1/kv/data/b', method: 'POST' }).reply(503, 'unavailable');
    }

    const client = makeClient({ maxRetries: 2, initialBackoffMs: 1 });
    await expect(client.kvWrite('kv', 'b', { armored: 'x' })).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.KEY_BACKEND_UNAVAILABLE }) as unknown as Error,
    );
    await client.close();
  });

  it('destroys all versions of a path', async () => {
    const pool = mockAgent.get(VAULT_ADDR);
    let destroyed = false;
    pool.intercept({ path: '/v1/kv/metadata/platform/keys/old', method: 'DELETE' }).reply(() => {
      destroyed = true;
      return { statusCode: 204, data: '' };
    });

    const client = makeClient();
    await client.kvDestroyAllVersions('kv', 'platform/keys/old');
    expect(destroyed).toBe(true);
    await client.close();
  });
});

describe('VaultClient transit', () => {
  it('signs, verifies, encrypts, decrypts, rotates', async () => {
    const pool = mockAgent.get(VAULT_ADDR);
    pool
      .intercept({ path: '/v1/transit/sign/mfa-key', method: 'POST' })
      .reply(200, { data: { signature: 'vault:v1:SIG', key_version: 1 } });
    pool
      .intercept({ path: '/v1/transit/verify/mfa-key', method: 'POST' })
      .reply(200, { data: { valid: true } });
    pool
      .intercept({ path: '/v1/transit/encrypt/mfa-key', method: 'POST' })
      .reply(200, { data: { ciphertext: 'vault:v1:CT', key_version: 1 } });
    pool
      .intercept({ path: '/v1/transit/decrypt/mfa-key', method: 'POST' })
      .reply(200, { data: { plaintext: 'cGxhaW4=' } });
    pool
      .intercept({ path: '/v1/transit/keys/mfa-key/rotate', method: 'POST' })
      .reply(200, { data: {} });

    const client = makeClient();
    const sig = await client.transitSign('transit', 'mfa-key', 'cGxhaW4=');
    expect(sig.data.signature).toBe('vault:v1:SIG');

    const verify = await client.transitVerify('transit', 'mfa-key', 'cGxhaW4=', 'vault:v1:SIG');
    expect(verify.data.valid).toBe(true);

    const ct = await client.transitEncrypt('transit', 'mfa-key', 'cGxhaW4=');
    expect(ct.data.ciphertext).toBe('vault:v1:CT');

    const pt = await client.transitDecrypt('transit', 'mfa-key', 'vault:v1:CT');
    expect(pt.data.plaintext).toBe('cGxhaW4=');

    await client.transitRotate('transit', 'mfa-key');
    await client.close();
  });
});

describe('VaultClient namespace header', () => {
  it('adds X-Vault-Namespace when configured', async () => {
    const pool = mockAgent.get(VAULT_ADDR);
    let namespaceHeader: string | null = null;
    pool.intercept({ path: '/v1/kv/data/x', method: 'GET' }).reply((opts) => {
      const headers = opts.headers as Record<string, string> | undefined;
      namespaceHeader = headers?.['X-Vault-Namespace'] ?? headers?.['x-vault-namespace'] ?? null;
      return {
        statusCode: 200,
        data: { data: { data: { armored: 'X' }, metadata: { version: 1 } } },
      };
    });

    const client = makeClient({ namespace: 'tenant-abc' });
    await client.kvRead('kv', 'x');
    expect(namespaceHeader).toBe('tenant-abc');
    await client.close();
  });
});
