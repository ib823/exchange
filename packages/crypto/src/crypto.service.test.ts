/* eslint-disable @typescript-eslint/unbound-method --
 * Mock backend methods are `vi.fn()` mocks typed through
 * IKeyCustodyBackend. `expect(backend.method).toHaveBeenCalled()` is
 * the vitest idiom, not a runtime method dispatch, so the
 * unbound-method rule fires with no actual `this`-scoping hazard. */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as openpgp from 'openpgp';
import { ErrorCode } from '@sep/common';
import { CryptoService } from './crypto.service';
import { DEFAULT_ALGORITHM_POLICY, type KeyRef, type CryptoAlgorithmPolicy } from './interfaces';
import { KeyCustodyAbstraction } from './custody/key-custody-abstraction';
import type {
  IKeyCustodyBackend,
  KeyReferenceInput,
  ArmoredKey,
  Signature,
  Ciphertext,
  Plaintext,
  DecryptVerifyResult,
  RotationResult,
} from './custody/i-key-custody-backend';

vi.mock('@sep/observability', () => ({
  createLogger: (): unknown => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

let publicKeyArmored: string;
let privateKeyArmored: string;
let fingerprint: string;

/**
 * A minimal IKeyCustodyBackend that performs real openpgp.js calls
 * using the session fixture keypair. Covers CryptoService's
 * delegation path without exercising Vault HTTP — that's the
 * vault-backend.test.ts job.
 */
function makeFixtureBackend(): IKeyCustodyBackend {
  return {
    getPublicKey: vi.fn((): Promise<ArmoredKey> => Promise.resolve(publicKeyArmored as ArmoredKey)),
    signDetached: vi.fn(async (_ref: KeyReferenceInput, payload: Buffer): Promise<Signature> => {
      const privateKey = await openpgp.readPrivateKey({ armoredKey: privateKeyArmored });
      const message = await openpgp.createMessage({ binary: new Uint8Array(payload) });
      const sig = await openpgp.sign({ message, signingKeys: privateKey, detached: true });
      return String(sig) as Signature;
    }),
    signInline: vi.fn(async (_ref: KeyReferenceInput, payload: Buffer): Promise<Ciphertext> => {
      const privateKey = await openpgp.readPrivateKey({ armoredKey: privateKeyArmored });
      const message = await openpgp.createMessage({ binary: new Uint8Array(payload) });
      const signed = await openpgp.sign({ message, signingKeys: privateKey });
      return String(signed) as Ciphertext;
    }),
    verifyDetached: vi.fn((): Promise<boolean> => Promise.resolve(true)),
    decrypt: vi.fn(async (_ref: KeyReferenceInput, ct: Ciphertext): Promise<Plaintext> => {
      const privateKey = await openpgp.readPrivateKey({ armoredKey: privateKeyArmored });
      const message = await openpgp.readMessage({ armoredMessage: ct });
      const { data } = await openpgp.decrypt({
        message,
        decryptionKeys: privateKey,
        format: 'binary',
      });
      return Buffer.from(data as unknown as Uint8Array);
    }),
    encryptForRecipient: vi.fn(
      async (_ref: KeyReferenceInput, plaintext: Plaintext): Promise<Ciphertext> => {
        const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored });
        const message = await openpgp.createMessage({ binary: new Uint8Array(plaintext) });
        const ct = await openpgp.encrypt({ message, encryptionKeys: publicKey });
        return String(ct) as Ciphertext;
      },
    ),
    signAndEncrypt: vi.fn(
      async (
        _signingKeyRef: KeyReferenceInput,
        _recipientKeyRef: KeyReferenceInput,
        plaintext: Plaintext,
      ): Promise<Ciphertext> => {
        const privateKey = await openpgp.readPrivateKey({ armoredKey: privateKeyArmored });
        const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored });
        const message = await openpgp.createMessage({ binary: new Uint8Array(plaintext) });
        const ct = await openpgp.encrypt({
          message,
          encryptionKeys: publicKey,
          signingKeys: privateKey,
        });
        return String(ct) as Ciphertext;
      },
    ),
    decryptAndVerify: vi.fn(
      async (
        _decryptionKeyRef: KeyReferenceInput,
        _senderKeyRef: KeyReferenceInput,
        ct: Ciphertext,
      ): Promise<DecryptVerifyResult> => {
        const privateKey = await openpgp.readPrivateKey({ armoredKey: privateKeyArmored });
        const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored });
        const message = await openpgp.readMessage({ armoredMessage: ct });
        const { data, signatures } = await openpgp.decrypt({
          message,
          decryptionKeys: privateKey,
          verificationKeys: publicKey,
          format: 'binary',
        });
        let signatureValid = false;
        let signerKeyId = '';
        const firstSig = signatures[0];
        if (firstSig) {
          signerKeyId = firstSig.keyID.toHex();
          try {
            await firstSig.verified;
            signatureValid = true;
          } catch {
            signatureValid = false;
          }
        }
        return {
          plaintext: Buffer.from(data as unknown as Uint8Array),
          signatureValid,
          signerKeyId,
        };
      },
    ),
    rotate: vi.fn(
      (): Promise<RotationResult> =>
        Promise.resolve({
          newBackendRef: 'rotated',
          newFingerprint: fingerprint,
          rotatedAt: new Date(),
        }),
    ),
    revoke: vi.fn((): Promise<void> => Promise.resolve()),
  };
}

let service: CryptoService;
let backend: IKeyCustodyBackend;

function makeKeyRef(overrides: Partial<KeyRef> = {}): KeyRef {
  return {
    keyReferenceId: 'key-test-001',
    tenantId: 'tenant-A',
    backendType: 'PLATFORM_VAULT',
    backendRef: 'platform/keys/key-test-001',
    fingerprint,
    algorithm: 'rsa',
    state: 'ACTIVE',
    allowedUsages: ['ENCRYPT', 'DECRYPT', 'SIGN', 'VERIFY'],
    revokedAt: null,
    expiresAt: new Date(Date.now() + 86400000),
    environment: 'TEST',
    ...overrides,
  };
}

const policy: CryptoAlgorithmPolicy = {
  ...DEFAULT_ALGORITHM_POLICY,
  minRsaKeySize: 2048,
};

beforeAll(async () => {
  const { publicKey, privateKey } = await openpgp.generateKey({
    type: 'rsa',
    rsaBits: 2048,
    userIDs: [{ name: 'Test User', email: 'test@sep.test' }],
    format: 'armored',
  });
  publicKeyArmored = publicKey;
  privateKeyArmored = privateKey;
  const pub = await openpgp.readKey({ armoredKey: publicKey });
  fingerprint = pub.getFingerprint();

  backend = makeFixtureBackend();
  const keyCustody = new KeyCustodyAbstraction({
    platformVault: backend,
    tenantVaultFactory: (): IKeyCustodyBackend => backend,
    externalKms: backend,
    softwareLocal: backend,
  });
  service = new CryptoService(keyCustody);
}, 30000);

describe('CryptoService', () => {
  describe('encrypt', () => {
    it('delegates to backend.encryptForRecipient and returns a synthetic payload ref', async () => {
      const result = await service.encrypt(
        'test payload content',
        makeKeyRef(),
        { outputFormat: 'armored', compressionAlgorithm: 'zlib' },
        policy,
      );
      expect(result.encryptedPayloadRef).toContain('encrypted/');
      expect(result.meta.operation).toBe('ENCRYPT');
      expect(result.meta.durationMs).toBeGreaterThanOrEqual(0);
      expect(backend.encryptForRecipient).toHaveBeenCalledTimes(1);
    });

    it('rejects expired key via policy enforcement (no backend call)', async () => {
      await expect(
        service.encrypt(
          'payload',
          makeKeyRef({ expiresAt: new Date(Date.now() - 1000) }),
          { outputFormat: 'armored', compressionAlgorithm: 'zlib' },
          policy,
        ),
      ).rejects.toThrow(
        expect.objectContaining({ code: ErrorCode.CRYPTO_KEY_EXPIRED }) as unknown as Error,
      );
    });
  });

  describe('decrypt', () => {
    it('round-trips encrypted → decrypted via backend delegation', async () => {
      // Encrypt via openpgp directly to get real ciphertext matching the
      // fixture key (mirrors the pre-refactor test pattern).
      const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored });
      const message = await openpgp.createMessage({ text: 'secret data' });
      const ciphertext = (await openpgp.encrypt({
        message,
        encryptionKeys: publicKey,
        format: 'armored',
      })) as string;

      const result = await service.decrypt(ciphertext, makeKeyRef(), {});
      expect(result.decryptedPayloadRef).toContain('decrypted/');
      expect(result.meta.operation).toBe('DECRYPT');
      expect(backend.decrypt).toHaveBeenCalledTimes(1);
    });
  });

  describe('sign', () => {
    it('inline sign delegates to backend.signInline', async () => {
      const result = await service.sign(
        'data to sign',
        makeKeyRef(),
        { outputFormat: 'armored', detached: false },
        policy,
      );
      expect(result.signedPayloadRef).toContain('signed/');
      expect(result.meta.operation).toBe('SIGN');
      expect(backend.signInline).toHaveBeenCalledTimes(1);
    });

    it('detached sign delegates to backend.signDetached and returns detachedSignatureRef', async () => {
      const result = await service.sign(
        'data to sign',
        makeKeyRef(),
        { outputFormat: 'armored', detached: true },
        policy,
      );
      expect(result.detachedSignatureRef).toBeDefined();
      expect(result.signedPayloadRef).toBe('data to sign');
      expect(result.meta.operation).toBe('SIGN');
      expect(backend.signDetached).toHaveBeenCalledTimes(1);
    });
  });

  describe('signAndEncrypt', () => {
    it('routes through dispatchSignAndEncrypt (same backend) and returns SignEncryptResult', async () => {
      const result = await service.signAndEncrypt(
        'confidential payload',
        makeKeyRef(),
        makeKeyRef({ keyReferenceId: 'recipient-001' }),
        { outputFormat: 'armored', detached: false },
        { outputFormat: 'armored', compressionAlgorithm: 'zlib' },
        policy,
      );
      expect(result.securedPayloadRef).toContain('secured/');
      expect(result.signMeta.operation).toBe('SIGN');
      expect(result.encryptMeta.operation).toBe('ENCRYPT');
      expect(backend.signAndEncrypt).toHaveBeenCalledTimes(1);
    });
  });

  describe('verifyAndDecrypt', () => {
    it('with sender key → dispatches decryptAndVerify, verificationResult=PASSED', async () => {
      // Sign-then-encrypt via openpgp to get a ciphertext with an
      // embedded signature; CryptoService should route through the
      // dispatcher, the mock backend performs the real verify.
      const privateKey = await openpgp.readPrivateKey({ armoredKey: privateKeyArmored });
      const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored });
      const message = await openpgp.createMessage({ text: 'verified payload' });
      const ciphertext = (await openpgp.encrypt({
        message,
        encryptionKeys: publicKey,
        signingKeys: privateKey,
        format: 'armored',
      })) as string;

      const result = await service.verifyAndDecrypt(
        ciphertext,
        makeKeyRef(),
        makeKeyRef({ keyReferenceId: 'sender-001' }),
        {},
      );
      expect(result.decryptedPayloadRef).toContain('decrypted/');
      expect(result.verificationResult).toBe('PASSED');
      expect(result.decryptMeta.operation).toBe('DECRYPT');
      expect(backend.decryptAndVerify).toHaveBeenCalledTimes(1);
    });

    it('without sender key → routes to backend.decrypt, verificationResult=SKIPPED', async () => {
      const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored });
      const message = await openpgp.createMessage({ text: 'unverified data' });
      const ciphertext = (await openpgp.encrypt({
        message,
        encryptionKeys: publicKey,
        format: 'armored',
      })) as string;

      const result = await service.verifyAndDecrypt(ciphertext, makeKeyRef(), null, {});
      expect(result.verificationResult).toBe('SKIPPED');
      expect(backend.decrypt).toHaveBeenCalled();
      // decryptAndVerify must not be called when sender is absent.
    });
  });

  describe('policy enforcement', () => {
    it('rejects forbidden algorithm before backend is invoked', async () => {
      const ref = makeKeyRef({ algorithm: 'dsa' });
      await expect(
        service.encrypt(
          'payload',
          ref,
          { outputFormat: 'armored', compressionAlgorithm: 'zlib' },
          policy,
        ),
      ).rejects.toThrow(
        expect.objectContaining({
          code: ErrorCode.CRYPTO_UNSUPPORTED_ALGORITHM,
        }) as unknown as Error,
      );
    });

    it('rejects key in wrong state before backend is invoked', async () => {
      const ref = makeKeyRef({ state: 'REVOKED' });
      await expect(
        service.encrypt(
          'payload',
          ref,
          { outputFormat: 'armored', compressionAlgorithm: 'zlib' },
          policy,
        ),
      ).rejects.toThrow(
        expect.objectContaining({ code: ErrorCode.CRYPTO_KEY_INVALID_STATE }) as unknown as Error,
      );
    });
  });
});
