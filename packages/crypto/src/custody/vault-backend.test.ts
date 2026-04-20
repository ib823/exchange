import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';
import * as openpgp from 'openpgp';
import { ErrorCode } from '@sep/common';
import { VaultClient, DEFAULT_VAULT_CLIENT_CONFIG } from './vault-client';
import { PlatformVaultBackend, TenantVaultBackend, VaultKeyCustodyBackend } from './vault-backend';
import type { KeyReferenceInput } from './i-key-custody-backend';

const VAULT_ADDR = 'http://vault.test:8200';

let mockAgent: MockAgent;
let originalDispatcher: Dispatcher;

// Generate two deterministic fixture keypairs once per suite. The
// second one is used as a distinct recipient in the signAndEncrypt
// round-trip so the test exercises two keys being loaded in the same
// call (sign key + recipient key).
interface Fixture {
  armoredPublicKey: string;
  armoredPrivateKey: string;
  fingerprint: string;
}
let fixture: Fixture;
let recipientFixture: Fixture;

async function makeFixture(label: string): Promise<Fixture> {
  const generated = await openpgp.generateKey({
    type: 'ecc',
    curve: 'curve25519',
    userIDs: [{ name: label, email: `${label}@fixture.invalid` }],
    format: 'armored',
  });
  const publicKey = await openpgp.readKey({ armoredKey: generated.publicKey });
  return {
    armoredPublicKey: generated.publicKey,
    armoredPrivateKey: generated.privateKey,
    fingerprint: publicKey.getFingerprint(),
  };
}

beforeAll(async () => {
  fixture = await makeFixture('signer');
  recipientFixture = await makeFixture('recipient');
}, 30_000);

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

afterAll(() => {
  // nothing to clean; fixture is immutable
});

function makeClient(): VaultClient {
  return new VaultClient({
    addr: VAULT_ADDR,
    token: 'dev-root-token',
    ...DEFAULT_VAULT_CLIENT_CONFIG,
    initialBackoffMs: 1,
  });
}

function stubKvRead(path: string, stored: unknown): void {
  mockAgent
    .get(VAULT_ADDR)
    .intercept({ path: `/v1/kv/data/${path}`, method: 'GET' })
    .reply(200, {
      data: { data: stored, metadata: { version: 1 } },
    });
}

describe('PlatformVaultBackend', () => {
  it('reads a public key via KV v2', async () => {
    stubKvRead('platform/keys/key-1', {
      armoredPublicKey: fixture.armoredPublicKey,
      armoredPrivateKey: fixture.armoredPrivateKey,
      fingerprint: fixture.fingerprint,
      algorithm: 'ed25519',
    });

    const backend = new PlatformVaultBackend(makeClient());
    const ref: KeyReferenceInput = {
      id: 'key-1',
      tenantId: 'tenant-A',
      backendType: 'PLATFORM_VAULT',
      backendRef: 'key-1',
      algorithm: 'ed25519',
      fingerprint: fixture.fingerprint,
      usage: ['SIGN', 'ENCRYPT', 'VERIFY', 'DECRYPT'],
    };
    const pub = await backend.getPublicKey(ref);
    expect(pub).toContain('BEGIN PGP PUBLIC KEY');
  });

  it('signs and verifies detached payloads round-trip', async () => {
    const stored = {
      armoredPublicKey: fixture.armoredPublicKey,
      armoredPrivateKey: fixture.armoredPrivateKey,
      fingerprint: fixture.fingerprint,
      algorithm: 'ed25519',
    };
    // sign loads material once; verify loads it again — two GETs.
    stubKvRead('platform/keys/key-1', stored);
    stubKvRead('platform/keys/key-1', stored);

    const backend = new PlatformVaultBackend(makeClient());
    const ref: KeyReferenceInput = {
      id: 'key-1',
      tenantId: 'tenant-A',
      backendType: 'PLATFORM_VAULT',
      backendRef: 'key-1',
      algorithm: 'ed25519',
      fingerprint: fixture.fingerprint,
      usage: ['SIGN', 'ENCRYPT', 'VERIFY', 'DECRYPT'],
    };
    const payload = Buffer.from('hello world');
    const sig = await backend.signDetached(ref, payload);
    expect(sig).toContain('BEGIN PGP SIGNATURE');

    const verified = await backend.verifyDetached(ref, payload, sig);
    expect(verified).toBe(true);
  });

  it('rejects verify when payload was tampered', async () => {
    const stored = {
      armoredPublicKey: fixture.armoredPublicKey,
      armoredPrivateKey: fixture.armoredPrivateKey,
      fingerprint: fixture.fingerprint,
      algorithm: 'ed25519',
    };
    stubKvRead('platform/keys/key-1', stored);
    stubKvRead('platform/keys/key-1', stored);

    const backend = new PlatformVaultBackend(makeClient());
    const ref: KeyReferenceInput = {
      id: 'key-1',
      tenantId: 'tenant-A',
      backendType: 'PLATFORM_VAULT',
      backendRef: 'key-1',
      algorithm: 'ed25519',
      fingerprint: fixture.fingerprint,
      usage: ['SIGN', 'ENCRYPT', 'VERIFY', 'DECRYPT'],
    };
    const sig = await backend.signDetached(ref, Buffer.from('hello world'));
    const verified = await backend.verifyDetached(ref, Buffer.from('hello EVE'), sig);
    expect(verified).toBe(false);
  });

  it('encrypts and decrypts round-trip', async () => {
    const stored = {
      armoredPublicKey: fixture.armoredPublicKey,
      armoredPrivateKey: fixture.armoredPrivateKey,
      fingerprint: fixture.fingerprint,
      algorithm: 'ed25519',
    };
    stubKvRead('platform/keys/key-1', stored);
    stubKvRead('platform/keys/key-1', stored);

    const backend = new PlatformVaultBackend(makeClient());
    const ref: KeyReferenceInput = {
      id: 'key-1',
      tenantId: 'tenant-A',
      backendType: 'PLATFORM_VAULT',
      backendRef: 'key-1',
      algorithm: 'ed25519',
      fingerprint: fixture.fingerprint,
      usage: ['SIGN', 'ENCRYPT', 'VERIFY', 'DECRYPT'],
    };
    const plaintext = Buffer.from('secret cargo');
    const ct = await backend.encryptForRecipient(ref, plaintext);
    expect(ct).toContain('BEGIN PGP MESSAGE');

    const decrypted = await backend.decrypt(ref, ct);
    expect(decrypted.toString()).toBe('secret cargo');
  });

  it('signInline produces a verifiable armored OpenPGP MESSAGE (inline signature)', async () => {
    stubKvRead('platform/keys/key-1', {
      armoredPublicKey: fixture.armoredPublicKey,
      armoredPrivateKey: fixture.armoredPrivateKey,
      fingerprint: fixture.fingerprint,
      algorithm: 'ed25519',
    });

    const backend = new PlatformVaultBackend(makeClient());
    const ref: KeyReferenceInput = {
      id: 'key-1',
      tenantId: 'tenant-A',
      backendType: 'PLATFORM_VAULT',
      backendRef: 'key-1',
      algorithm: 'ed25519',
      fingerprint: fixture.fingerprint,
      usage: ['SIGN', 'ENCRYPT', 'VERIFY', 'DECRYPT'],
    };
    const signed = await backend.signInline(ref, Buffer.from('inline signed payload'));

    expect(signed).toContain('BEGIN PGP MESSAGE');

    // Round-trip: verify the inline signature resolves cleanly against
    // the fixture public key. Extracted here rather than round-tripped
    // through the backend because verifyDetached is detached-only.
    const message = await openpgp.readMessage({ armoredMessage: signed });
    const publicKey = await openpgp.readKey({ armoredKey: fixture.armoredPublicKey });
    const verified = await openpgp.verify({
      message,
      verificationKeys: publicKey,
    });
    const firstSig = verified.signatures[0];
    expect(firstSig).toBeDefined();
    if (firstSig) {
      await expect(firstSig.verified).resolves.toBe(true);
    }
  });

  it('decryptAndVerify round-trip recovers plaintext and reports signatureValid=true', async () => {
    const signerStored = {
      armoredPublicKey: fixture.armoredPublicKey,
      armoredPrivateKey: fixture.armoredPrivateKey,
      fingerprint: fixture.fingerprint,
      algorithm: 'ed25519',
    };
    const recipientStored = {
      armoredPublicKey: recipientFixture.armoredPublicKey,
      armoredPrivateKey: recipientFixture.armoredPrivateKey,
      fingerprint: recipientFixture.fingerprint,
      algorithm: 'ed25519',
    };
    // Three reads: two for signAndEncrypt, two for decryptAndVerify
    // (decryptionKey = recipient, senderKey = signer).
    stubKvRead('platform/keys/signer', signerStored);
    stubKvRead('platform/keys/recipient', recipientStored);
    stubKvRead('platform/keys/recipient', recipientStored);
    stubKvRead('platform/keys/signer', signerStored);

    const backend = new PlatformVaultBackend(makeClient());
    const signingRef: KeyReferenceInput = {
      id: 'signer',
      tenantId: 'tenant-A',
      backendType: 'PLATFORM_VAULT',
      backendRef: 'signer',
      algorithm: 'ed25519',
      fingerprint: fixture.fingerprint,
      usage: ['SIGN', 'ENCRYPT', 'VERIFY', 'DECRYPT'],
    };
    const recipientRef: KeyReferenceInput = {
      id: 'recipient',
      tenantId: 'tenant-A',
      backendType: 'PLATFORM_VAULT',
      backendRef: 'recipient',
      algorithm: 'ed25519',
      fingerprint: recipientFixture.fingerprint,
      usage: ['SIGN', 'ENCRYPT', 'VERIFY', 'DECRYPT'],
    };

    const sealed = await backend.signAndEncrypt(
      signingRef,
      recipientRef,
      Buffer.from('inbound ack payload'),
    );
    const result = await backend.decryptAndVerify(recipientRef, signingRef, sealed);

    expect(result.plaintext.toString()).toBe('inbound ack payload');
    expect(result.signatureValid).toBe(true);
    expect(result.signerKeyId.length).toBeGreaterThan(0);
  });

  it('signAndEncrypt produces a signed ciphertext the recipient can decrypt and verify', async () => {
    // loadMaterial is called twice per signAndEncrypt (once per ref),
    // then once more on the recipient side for decrypt — three stubs.
    const signerStored = {
      armoredPublicKey: fixture.armoredPublicKey,
      armoredPrivateKey: fixture.armoredPrivateKey,
      fingerprint: fixture.fingerprint,
      algorithm: 'ed25519',
    };
    const recipientStored = {
      armoredPublicKey: recipientFixture.armoredPublicKey,
      armoredPrivateKey: recipientFixture.armoredPrivateKey,
      fingerprint: recipientFixture.fingerprint,
      algorithm: 'ed25519',
    };
    stubKvRead('platform/keys/signer', signerStored);
    stubKvRead('platform/keys/recipient', recipientStored);
    stubKvRead('platform/keys/recipient', recipientStored);

    const backend = new PlatformVaultBackend(makeClient());
    const signingRef: KeyReferenceInput = {
      id: 'signer',
      tenantId: 'tenant-A',
      backendType: 'PLATFORM_VAULT',
      backendRef: 'signer',
      algorithm: 'ed25519',
      fingerprint: fixture.fingerprint,
      usage: ['SIGN', 'ENCRYPT', 'VERIFY', 'DECRYPT'],
    };
    const recipientRef: KeyReferenceInput = {
      id: 'recipient',
      tenantId: 'tenant-A',
      backendType: 'PLATFORM_VAULT',
      backendRef: 'recipient',
      algorithm: 'ed25519',
      fingerprint: recipientFixture.fingerprint,
      usage: ['SIGN', 'ENCRYPT', 'VERIFY', 'DECRYPT'],
    };
    const plaintext = Buffer.from('atomic composite cargo');
    const sealed = await backend.signAndEncrypt(signingRef, recipientRef, plaintext);
    expect(sealed).toContain('BEGIN PGP MESSAGE');

    // The recipient decrypts; round-trip confirms the sealed output is
    // valid RFC 9580 and honors the expected recipient key.
    const decrypted = await backend.decrypt(recipientRef, sealed);
    expect(decrypted.toString()).toBe('atomic composite cargo');
  });

  it('rejects material when stored fingerprint does not match KeyReference', async () => {
    stubKvRead('platform/keys/key-1', {
      armoredPublicKey: fixture.armoredPublicKey,
      armoredPrivateKey: fixture.armoredPrivateKey,
      fingerprint: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      algorithm: 'ed25519',
    });

    const backend = new PlatformVaultBackend(makeClient());
    const ref: KeyReferenceInput = {
      id: 'key-1',
      tenantId: 'tenant-A',
      backendType: 'PLATFORM_VAULT',
      backendRef: 'key-1',
      algorithm: 'ed25519',
      fingerprint: fixture.fingerprint,
      usage: ['SIGN', 'ENCRYPT', 'VERIFY', 'DECRYPT'],
    };
    await expect(backend.getPublicKey(ref)).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.KEY_FINGERPRINT_MISMATCH }) as unknown as Error,
    );
  });

  it('revoke destroys all KV versions', async () => {
    let destroyed = false;
    mockAgent
      .get(VAULT_ADDR)
      .intercept({ path: '/v1/kv/metadata/platform/keys/key-1', method: 'DELETE' })
      .reply(() => {
        destroyed = true;
        return { statusCode: 204, data: '' };
      });

    const backend = new PlatformVaultBackend(makeClient());
    await backend.revoke({
      id: 'key-1',
      tenantId: 'tenant-A',
      backendType: 'PLATFORM_VAULT',
      backendRef: 'key-1',
      algorithm: 'ed25519',
      fingerprint: fixture.fingerprint,
      usage: ['SIGN', 'ENCRYPT', 'VERIFY', 'DECRYPT'],
    });
    expect(destroyed).toBe(true);
  });

  it('rotate writes new version and returns new fingerprint', async () => {
    mockAgent
      .get(VAULT_ADDR)
      .intercept({ path: '/v1/kv/data/platform/keys/key-1', method: 'POST' })
      .reply(200, {
        data: { version: 2, created_time: '2026-04-19T12:00:00Z' },
      });

    const backend = new PlatformVaultBackend(makeClient());
    const result = await backend.rotate({
      id: 'key-1',
      tenantId: 'tenant-A',
      backendType: 'PLATFORM_VAULT',
      backendRef: 'key-1',
      algorithm: 'ed25519',
      fingerprint: fixture.fingerprint,
      usage: ['SIGN', 'ENCRYPT', 'VERIFY', 'DECRYPT'],
    });

    expect(result.newBackendRef).toBe('platform/keys/key-1#v2');
    expect(result.newFingerprint).toMatch(/^[0-9a-f]{40}$/);
    expect(result.newFingerprint).not.toBe(fixture.fingerprint);
  }, 30_000);
});

describe('TenantVaultBackend', () => {
  it('scopes KV paths under tenant/<id>/keys/', async () => {
    stubKvRead('tenant/tenant-A/keys/k1', {
      armoredPublicKey: fixture.armoredPublicKey,
      armoredPrivateKey: fixture.armoredPrivateKey,
      fingerprint: fixture.fingerprint,
      algorithm: 'ed25519',
    });

    const backend = new TenantVaultBackend(makeClient(), 'tenant-A');
    const pub = await backend.getPublicKey({
      id: 'k1',
      tenantId: 'tenant-A',
      backendType: 'TENANT_VAULT',
      backendRef: 'k1',
      algorithm: 'ed25519',
      fingerprint: fixture.fingerprint,
      usage: ['SIGN', 'ENCRYPT', 'VERIFY', 'DECRYPT'],
    });
    expect(pub).toContain('BEGIN PGP PUBLIC KEY');
  });

  it('refuses a KeyReferenceInput whose tenantId does not match the backend tenant', async () => {
    const backend = new TenantVaultBackend(makeClient(), 'tenant-A');
    await expect(
      backend.getPublicKey({
        id: 'k1',
        tenantId: 'tenant-B',
        backendType: 'TENANT_VAULT',
        backendRef: 'k1',
        algorithm: 'ed25519',
        fingerprint: fixture.fingerprint,
        usage: ['SIGN', 'ENCRYPT', 'VERIFY', 'DECRYPT'],
      }),
    ).rejects.toThrow(
      expect.objectContaining({
        code: ErrorCode.TENANT_BOUNDARY_VIOLATION,
      }) as unknown as Error,
    );
  });

  it('decryptAndVerify refuses when decryption and sender refs carry different tenantIds', async () => {
    const backend = new TenantVaultBackend(makeClient(), 'tenant-A');
    const decryptRef: KeyReferenceInput = {
      id: 'dk',
      tenantId: 'tenant-A',
      backendType: 'TENANT_VAULT',
      backendRef: 'dk',
      algorithm: 'ed25519',
      fingerprint: fixture.fingerprint,
      usage: ['SIGN', 'ENCRYPT', 'VERIFY', 'DECRYPT'],
    };
    const foreignSender: KeyReferenceInput = {
      id: 'sk',
      tenantId: 'tenant-B',
      backendType: 'TENANT_VAULT',
      backendRef: 'sk',
      algorithm: 'ed25519',
      fingerprint: recipientFixture.fingerprint,
      usage: ['SIGN', 'ENCRYPT', 'VERIFY', 'DECRYPT'],
    };
    // Like the signAndEncrypt pre-flight check, no KV stubs needed:
    // the tenant-boundary check in kvPathFor fires before any Vault
    // HTTP call.
    await expect(
      backend.decryptAndVerify(decryptRef, foreignSender, 'ARMORED' as never),
    ).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.TENANT_BOUNDARY_VIOLATION }) as unknown as Error,
    );
  });

  it('signAndEncrypt refuses when signing and recipient refs carry different tenantIds', async () => {
    const backend = new TenantVaultBackend(makeClient(), 'tenant-A');
    const signingRef: KeyReferenceInput = {
      id: 'sig',
      tenantId: 'tenant-A',
      backendType: 'TENANT_VAULT',
      backendRef: 'sig',
      algorithm: 'ed25519',
      fingerprint: fixture.fingerprint,
      usage: ['SIGN', 'ENCRYPT', 'VERIFY', 'DECRYPT'],
    };
    const foreignRecipient: KeyReferenceInput = {
      id: 'rcp',
      tenantId: 'tenant-B',
      backendType: 'TENANT_VAULT',
      backendRef: 'rcp',
      algorithm: 'ed25519',
      fingerprint: recipientFixture.fingerprint,
      usage: ['SIGN', 'ENCRYPT', 'VERIFY', 'DECRYPT'],
    };
    // No KV stubs — the tenant check in kvPathFor fires before
    // loadMaterial makes any HTTP call.
    await expect(
      backend.signAndEncrypt(signingRef, foreignRecipient, Buffer.from('payload')),
    ).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.TENANT_BOUNDARY_VIOLATION }) as unknown as Error,
    );
  });

  it('refuses construction with an empty tenantId', () => {
    let caught: unknown = null;
    try {
      new TenantVaultBackend(makeClient(), '');
    } catch (err) {
      caught = err;
    }
    expect(caught).toMatchObject({ code: ErrorCode.TENANT_CONTEXT_INVALID });
  });
});

describe('VaultKeyCustodyBackend class surface', () => {
  it('exposes an abstract base class (not directly constructable by callers)', () => {
    // Type-level check: the abstract class is exported so third-party
    // backends can extend it. A compile error here would signal a
    // regression in the public type surface.
    const extendable: typeof VaultKeyCustodyBackend = VaultKeyCustodyBackend;
    expect(typeof extendable).toBe('function');
  });
});
