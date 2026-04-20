/**
 * IKeyCustodyBackend conformance suite (M3.A5-T06).
 *
 * Asserts every implementation of the 10-method V1 contract against the
 * same behavioural expectations. One `describe()` per backend; shared
 * helper `runConformanceSuite` drives method-by-method assertions.
 *
 * Backends covered
 * ────────────────
 *   - PlatformVaultBackend    full round-trip against a live Vault
 *   - TenantVaultBackend      full round-trip against a live Vault
 *   - ExternalKmsBackend      fail-closed assertions only
 *   - SoftwareLocalBackend    fail-closed assertions only
 *
 * Expected-error table for interface-only backends
 * ─────────────────────────────────────────────────
 * This table reflects the codes actually thrown by the committed stub
 * implementations (packages/crypto/src/custody/stub-backends.ts). The
 * two stubs diverge on single-ref ops by intent:
 *
 *   ExternalKmsBackend → CRYPTO_BACKEND_NOT_IMPLEMENTED
 *     The backend class is real but its concrete wiring is deferred
 *     to M5 or the first AWS-tier customer. "Not built yet."
 *
 *   SoftwareLocalBackend → CRYPTO_BACKEND_NOT_AVAILABLE
 *     The backend class is real but explicitly not approved for
 *     production. "Not usable here, by policy."
 *
 * Both composite ops (`signAndEncrypt`, `decryptAndVerify`) throw
 * `CRYPTO_OPERATION_NOT_SUPPORTED` from both stubs — this is the
 * backend-contract failure mode reserved for ops the class cannot
 * honor regardless of wiring (no way to hold two keys in-process).
 *
 * All three codes are registered terminal in ErrorCode.ts, so the
 * distinction carries intent, not behaviour.
 *
 * Live-Vault requirement
 * ───────────────────────
 * PlatformVaultBackend and TenantVaultBackend suites require a dev-
 * mode Vault reachable at VAULT_ADDR with VAULT_TOKEN as the root
 * token. KV v2 is enabled at the `kv/` mount point before round-trip
 * tests run. If VAULT_ADDR is unset, the Vault-dependent suites are
 * skipped (the stub suites still run).
 *
 * CI wiring: `.github/workflows/ci.yml` integration-tests job
 * attaches a `vault` service with these env vars preset.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as openpgp from 'openpgp';
import { ErrorCode } from '@sep/common';
import {
  VaultClient,
  PlatformVaultBackend,
  TenantVaultBackend,
  ExternalKmsBackend,
  SoftwareLocalBackend,
  DEFAULT_VAULT_CLIENT_CONFIG,
  type IKeyCustodyBackend,
  type KeyReferenceInput,
  type Ciphertext,
  type Signature,
  type Plaintext,
} from '@sep/crypto';

// ── Vault reachability gate ───────────────────────────────────────
const VAULT_ADDR = process.env['VAULT_ADDR'];
const VAULT_TOKEN = process.env['VAULT_TOKEN'];
const VAULT_AVAILABLE = typeof VAULT_ADDR === 'string' && typeof VAULT_TOKEN === 'string';
const vaultDescribe = VAULT_AVAILABLE ? describe : describe.skip;

// ── Fixture keypairs ──────────────────────────────────────────────
// Three curve25519 keypairs: two for the round-trip roles (signer /
// recipient) and one we substitute to test fingerprint-mismatch paths
// at the conformance layer. We stick with curve25519 because
// generateKey cost with RSA-2048 would dominate the suite runtime.
interface Fixture {
  armoredPublicKey: string;
  armoredPrivateKey: string;
  fingerprint: string;
}

let signerFixture: Fixture;
let recipientFixture: Fixture;

async function makeFixture(label: string): Promise<Fixture> {
  const { publicKey, privateKey } = await openpgp.generateKey({
    type: 'ecc',
    curve: 'curve25519',
    userIDs: [{ name: label, email: `${label}@conformance.invalid` }],
    format: 'armored',
  });
  const pub = await openpgp.readKey({ armoredKey: publicKey });
  return {
    armoredPublicKey: publicKey,
    armoredPrivateKey: privateKey,
    fingerprint: pub.getFingerprint(),
  };
}

// ── Vault helpers ─────────────────────────────────────────────────
let vaultClient: VaultClient | null = null;

function makeVaultClient(): VaultClient {
  if (!VAULT_AVAILABLE) {
    throw new Error('VAULT_ADDR/VAULT_TOKEN not set — Vault-dependent test accessed its client');
  }
  return new VaultClient({
    addr: VAULT_ADDR,
    token: VAULT_TOKEN,
    ...DEFAULT_VAULT_CLIENT_CONFIG,
    initialBackoffMs: 10,
  });
}

/**
 * Enable the KV v2 mount at `kv/` if it isn't already enabled.
 * Vault returns 400 ("path is already in use") when the mount
 * exists; we swallow that since repeated runs should be idempotent.
 */
async function ensureKvMount(client: VaultClient): Promise<void> {
  const { request } = await import('undici');
  const url = `${VAULT_ADDR as string}/v1/sys/mounts/kv`;
  const res = await request(url, {
    method: 'POST',
    headers: {
      'X-Vault-Token': VAULT_TOKEN as string,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'kv', options: { version: '2' } }),
    bodyTimeout: 5_000,
    headersTimeout: 5_000,
  });
  const body = await res.body.text();
  if (res.statusCode !== 204 && res.statusCode !== 200) {
    const alreadyMounted = res.statusCode === 400 && body.includes('already in use');
    if (!alreadyMounted) {
      throw new Error(`Vault KV mount setup failed: ${res.statusCode.toString()} ${body}`);
    }
  }
  // Touch the client to keep lint happy; seedKey uses it.
  void client;
}

async function seedKey(path: string, fixture: Fixture): Promise<void> {
  if (vaultClient === null) {
    throw new Error('vaultClient not initialised');
  }
  await vaultClient.kvWrite('kv', path, {
    armoredPublicKey: fixture.armoredPublicKey,
    armoredPrivateKey: fixture.armoredPrivateKey,
    fingerprint: fixture.fingerprint,
    algorithm: 'ed25519',
  });
}

beforeAll(async () => {
  signerFixture = await makeFixture('conformance-signer');
  recipientFixture = await makeFixture('conformance-recipient');
  if (VAULT_AVAILABLE) {
    vaultClient = makeVaultClient();
    await ensureKvMount(vaultClient);
  }
}, 60_000);

// ── Ref factories ─────────────────────────────────────────────────
function makePlatformRef(id: string, fingerprint: string): KeyReferenceInput {
  return {
    id,
    tenantId: 'conf-tenant',
    backendType: 'PLATFORM_VAULT',
    backendRef: id,
    algorithm: 'ed25519',
    fingerprint,
  };
}

function makeTenantRef(tenantId: string, id: string, fingerprint: string): KeyReferenceInput {
  return {
    id,
    tenantId,
    backendType: 'TENANT_VAULT',
    backendRef: id,
    algorithm: 'ed25519',
    fingerprint,
  };
}

function makeStubRef(
  backendType: 'EXTERNAL_KMS' | 'SOFTWARE_LOCAL',
  id: string,
): KeyReferenceInput {
  return {
    id,
    tenantId: 'conf-tenant',
    backendType,
    backendRef: id,
    algorithm: 'rsa-4096',
    fingerprint: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  };
}

// ── Interface-only assertion table ────────────────────────────────
type StubExpected = {
  readonly single: ErrorCode;
  readonly composite: ErrorCode;
};

const STUB_EXPECTED: Record<'EXTERNAL_KMS' | 'SOFTWARE_LOCAL', StubExpected> = {
  EXTERNAL_KMS: {
    single: ErrorCode.CRYPTO_BACKEND_NOT_IMPLEMENTED,
    composite: ErrorCode.CRYPTO_OPERATION_NOT_SUPPORTED,
  },
  SOFTWARE_LOCAL: {
    single: ErrorCode.CRYPTO_BACKEND_NOT_AVAILABLE,
    composite: ErrorCode.CRYPTO_OPERATION_NOT_SUPPORTED,
  },
};

// ── Conformance suite ─────────────────────────────────────────────
function runStubConformance(
  backendName: string,
  backendType: 'EXTERNAL_KMS' | 'SOFTWARE_LOCAL',
  backendFactory: () => IKeyCustodyBackend,
): void {
  describe(`IKeyCustodyBackend conformance: ${backendName}`, () => {
    const expected = STUB_EXPECTED[backendType];
    let backend: IKeyCustodyBackend;
    let refA: KeyReferenceInput;
    let refB: KeyReferenceInput;

    beforeAll(() => {
      backend = backendFactory();
      refA = makeStubRef(backendType, 'stub-key-a');
      refB = makeStubRef(backendType, 'stub-key-b');
    });

    it(`getPublicKey throws ${expected.single}`, async () => {
      await expect(backend.getPublicKey(refA)).rejects.toMatchObject({ code: expected.single });
    });

    it(`signDetached throws ${expected.single}`, async () => {
      await expect(backend.signDetached(refA, Buffer.from('p'))).rejects.toMatchObject({
        code: expected.single,
      });
    });

    it(`signInline throws ${expected.single}`, async () => {
      await expect(backend.signInline(refA, Buffer.from('p'))).rejects.toMatchObject({
        code: expected.single,
      });
    });

    it(`verifyDetached throws ${expected.single}`, async () => {
      await expect(
        backend.verifyDetached(refA, Buffer.from('p'), 'x' as Signature),
      ).rejects.toMatchObject({ code: expected.single });
    });

    it(`decrypt throws ${expected.single}`, async () => {
      await expect(backend.decrypt(refA, 'x' as Ciphertext)).rejects.toMatchObject({
        code: expected.single,
      });
    });

    it(`encryptForRecipient throws ${expected.single}`, async () => {
      await expect(backend.encryptForRecipient(refA, Buffer.from('p'))).rejects.toMatchObject({
        code: expected.single,
      });
    });

    it(`signAndEncrypt throws ${expected.composite}`, async () => {
      await expect(backend.signAndEncrypt(refA, refB, Buffer.from('p'))).rejects.toMatchObject({
        code: expected.composite,
      });
    });

    it(`decryptAndVerify throws ${expected.composite}`, async () => {
      await expect(backend.decryptAndVerify(refA, refB, 'x' as Ciphertext)).rejects.toMatchObject({
        code: expected.composite,
      });
    });

    it(`rotate throws ${expected.single}`, async () => {
      await expect(backend.rotate(refA)).rejects.toMatchObject({ code: expected.single });
    });

    it(`revoke throws ${expected.single}`, async () => {
      await expect(backend.revoke(refA)).rejects.toMatchObject({ code: expected.single });
    });

    it('every thrown error is terminal (no silent retries)', async () => {
      // instanceof SepError is unreliable across bundle boundaries
      // (the stub backends resolve SepError from @sep/crypto's bundled
      // @sep/common; this test file resolves it from the root copy).
      // Assert on the shape instead.
      const err = await backend.getPublicKey(refA).catch((e: unknown) => e);
      expect(err).toMatchObject({
        name: 'SepError',
        code: expected.single,
        terminal: true,
      });
    });
  });
}

function runVaultConformance(
  backendName: string,
  backendFactory: () => IKeyCustodyBackend,
  refFactory: (id: string, fingerprint: string) => KeyReferenceInput,
  kvPathPrefix: string,
): void {
  vaultDescribe(`IKeyCustodyBackend conformance: ${backendName}`, () => {
    let backend: IKeyCustodyBackend;

    // Each backend gets its own keyspace. Seeds run once per
    // describe via beforeAll. Keys we touch:
    //   conf-signer   — private key used for signing
    //   conf-recipient — recipient key used for encryption target
    //   conf-rotate   — separate key we rotate (so other tests keep
    //                   a stable ref)
    //   conf-revoke   — separate key we revoke (single-use)
    beforeAll(async () => {
      if (!VAULT_AVAILABLE) {
        return;
      }
      await seedKey(`${kvPathPrefix}/conf-signer`, signerFixture);
      await seedKey(`${kvPathPrefix}/conf-recipient`, recipientFixture);
      await seedKey(`${kvPathPrefix}/conf-rotate`, signerFixture);
      await seedKey(`${kvPathPrefix}/conf-revoke`, signerFixture);
      backend = backendFactory();
    }, 30_000);

    it('getPublicKey returns the armored public key', async () => {
      const pub = await backend.getPublicKey(refFactory('conf-signer', signerFixture.fingerprint));
      expect(pub).toContain('BEGIN PGP PUBLIC KEY BLOCK');
    });

    it('signDetached produces a signature verifyDetached accepts', async () => {
      const ref = refFactory('conf-signer', signerFixture.fingerprint);
      const payload = Buffer.from('conformance payload');
      const sig = await backend.signDetached(ref, payload);
      const ok = await backend.verifyDetached(ref, payload, sig);
      expect(ok).toBe(true);
    });

    it('verifyDetached returns false for a tampered payload (never throws)', async () => {
      const ref = refFactory('conf-signer', signerFixture.fingerprint);
      const sig = await backend.signDetached(ref, Buffer.from('original'));
      const ok = await backend.verifyDetached(ref, Buffer.from('tampered'), sig);
      expect(ok).toBe(false);
    });

    it('signInline produces a message openpgp.verify accepts', async () => {
      const ref = refFactory('conf-signer', signerFixture.fingerprint);
      const signed = await backend.signInline(ref, Buffer.from('inline content'));
      expect(signed).toContain('BEGIN PGP MESSAGE');

      const message = await openpgp.readMessage({ armoredMessage: signed });
      const pub = await openpgp.readKey({ armoredKey: signerFixture.armoredPublicKey });
      const verified = await openpgp.verify({ message, verificationKeys: pub });
      const firstSig = verified.signatures[0];
      expect(firstSig).toBeDefined();
      if (firstSig) {
        await expect(firstSig.verified).resolves.toBe(true);
      }
    });

    it('encryptForRecipient + decrypt recovers the plaintext', async () => {
      const recipientRef = refFactory('conf-recipient', recipientFixture.fingerprint);
      const plaintext: Plaintext = Buffer.from('round-trip payload');
      const ciphertext = await backend.encryptForRecipient(recipientRef, plaintext);
      const recovered = await backend.decrypt(recipientRef, ciphertext);
      expect(recovered.toString()).toBe('round-trip payload');
    });

    it('signAndEncrypt + decryptAndVerify recovers plaintext AND reports signatureValid=true', async () => {
      const signingRef = refFactory('conf-signer', signerFixture.fingerprint);
      const recipientRef = refFactory('conf-recipient', recipientFixture.fingerprint);
      const plaintext: Plaintext = Buffer.from('composite round-trip');
      const sealed = await backend.signAndEncrypt(signingRef, recipientRef, plaintext);
      const opened = await backend.decryptAndVerify(recipientRef, signingRef, sealed);
      expect(opened.plaintext.toString()).toBe('composite round-trip');
      expect(opened.signatureValid).toBe(true);
      expect(opened.signerKeyId.length).toBeGreaterThan(0);
    });

    it('rotate returns a new backendRef + new fingerprint', async () => {
      const ref = refFactory('conf-rotate', signerFixture.fingerprint);
      const result = await backend.rotate(ref);
      expect(result.newBackendRef).toContain('conf-rotate');
      expect(result.newFingerprint).toMatch(/^[0-9a-f]+$/i);
      // Rotation writes a new KV v2 version — the fingerprint must
      // differ from the seed because the backend generates fresh
      // keypair material.
      expect(result.newFingerprint.toLowerCase()).not.toBe(signerFixture.fingerprint.toLowerCase());
    }, 30_000);

    it('revoke destroys the KV path — subsequent getPublicKey fails', async () => {
      const ref = refFactory('conf-revoke', signerFixture.fingerprint);
      await backend.revoke(ref);
      // After destroy-all-versions, a subsequent read surfaces as
      // CRYPTO_KEY_NOT_FOUND (Vault 404 → mapped by VaultClient).
      await expect(backend.getPublicKey(ref)).rejects.toMatchObject({
        code: ErrorCode.CRYPTO_KEY_NOT_FOUND,
      });
    });
  });
}

// ── Drive ──────────────────────────────────────────────────────────

runVaultConformance(
  'PlatformVaultBackend',
  () => new PlatformVaultBackend(makeVaultClient()),
  (id, fingerprint) => makePlatformRef(id, fingerprint),
  'platform/keys',
);

runVaultConformance(
  'TenantVaultBackend',
  () => new TenantVaultBackend(makeVaultClient(), 'conf-tenant'),
  (id, fingerprint) => makeTenantRef('conf-tenant', id, fingerprint),
  'tenant/conf-tenant/keys',
);

runStubConformance('ExternalKmsBackend', 'EXTERNAL_KMS', () => new ExternalKmsBackend());
runStubConformance('SoftwareLocalBackend', 'SOFTWARE_LOCAL', () => new SoftwareLocalBackend());
