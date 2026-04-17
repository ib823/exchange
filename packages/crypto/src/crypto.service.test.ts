/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/explicit-function-return-type, no-duplicate-imports */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as openpgp from 'openpgp';
import { ErrorCode } from '@sep/common';
import { CryptoService } from './crypto.service';
import { DEFAULT_ALGORITHM_POLICY, type KeyRef, type CryptoAlgorithmPolicy } from './interfaces';

vi.mock('@sep/observability', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

let publicKeyArmored: string;
let privateKeyArmored: string;
let service: CryptoService;

function makeKeyRef(overrides: Partial<KeyRef> = {}): KeyRef {
  return {
    keyReferenceId: 'key-test-001',
    backendRef: publicKeyArmored, // In tests, backendRef IS the armored key
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
  minRsaKeySize: 2048, // Lower for test speed
};

beforeAll(async () => {
  // Generate a test RSA keypair — 2048 bits for test speed
  const { publicKey, privateKey } = await openpgp.generateKey({
    type: 'rsa',
    rsaBits: 2048,
    userIDs: [{ name: 'Test User', email: 'test@sep.test' }],
    format: 'armored',
  });
  publicKeyArmored = publicKey;
  privateKeyArmored = privateKey;
  service = new CryptoService();
}, 30000); // Key generation can be slow

describe('CryptoService', () => {
  describe('encrypt', () => {
    it('encrypts a payload successfully', async () => {
      const result = await service.encrypt(
        'test payload content',
        makeKeyRef({ backendRef: publicKeyArmored }),
        { outputFormat: 'armored', compressionAlgorithm: 'zlib' },
        policy,
      );
      expect(result.encryptedPayloadRef).toContain('encrypted/');
      expect(result.meta.operation).toBe('ENCRYPT');
      expect(result.meta.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('rejects expired key via policy enforcement', async () => {
      await expect(
        service.encrypt(
          'payload',
          makeKeyRef({ expiresAt: new Date(Date.now() - 1000) }),
          { outputFormat: 'armored', compressionAlgorithm: 'zlib' },
          policy,
        ),
      ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.CRYPTO_KEY_EXPIRED }));
    });
  });

  describe('decrypt', () => {
    it('encrypts then decrypts roundtrip', async () => {
      const privRef = makeKeyRef({ backendRef: privateKeyArmored, allowedUsages: ['DECRYPT'] });

      // Encrypt with openpgp directly to get ciphertext
      const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored });
      const message = await openpgp.createMessage({ text: 'secret data' });
      const ciphertext = (await openpgp.encrypt({
        message,
        encryptionKeys: publicKey,
        format: 'armored',
      })) as string;

      const result = await service.decrypt(ciphertext, privRef, {});
      expect(result.decryptedPayloadRef).toContain('decrypted/');
      expect(result.meta.operation).toBe('DECRYPT');
    });
  });

  describe('sign', () => {
    it('produces an inline signature', async () => {
      const result = await service.sign(
        'data to sign',
        makeKeyRef({ backendRef: privateKeyArmored }),
        { outputFormat: 'armored', detached: false },
        policy,
      );
      expect(result.signedPayloadRef).toContain('signed/');
      expect(result.meta.operation).toBe('SIGN');
    });

    it('produces a detached signature', async () => {
      const result = await service.sign(
        'data to sign',
        makeKeyRef({ backendRef: privateKeyArmored }),
        { outputFormat: 'armored', detached: true },
        policy,
      );
      expect(result.detachedSignatureRef).toBeDefined();
      expect(result.signedPayloadRef).toBe('data to sign');
      expect(result.meta.operation).toBe('SIGN');
    });
  });

  describe('signAndEncrypt', () => {
    it('signs then encrypts in correct order', async () => {
      const signingRef = makeKeyRef({ backendRef: privateKeyArmored });
      const recipientRef = makeKeyRef({ backendRef: publicKeyArmored });

      const result = await service.signAndEncrypt(
        'confidential payload',
        signingRef,
        recipientRef,
        { outputFormat: 'armored', detached: false },
        { outputFormat: 'armored', compressionAlgorithm: 'zlib' },
        policy,
      );

      expect(result.securedPayloadRef).toContain('secured/');
      expect(result.signMeta.operation).toBe('SIGN');
      expect(result.encryptMeta.operation).toBe('ENCRYPT');
    });
  });

  describe('verifyAndDecrypt', () => {
    it('decrypts and verifies a signed-then-encrypted message', async () => {
      const privateKey = await openpgp.readPrivateKey({ armoredKey: privateKeyArmored });
      const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored });

      // Sign and encrypt with openpgp directly
      const message = await openpgp.createMessage({ text: 'verified payload' });
      const ciphertext = (await openpgp.encrypt({
        message,
        encryptionKeys: publicKey,
        signingKeys: privateKey,
        format: 'armored',
      })) as string;

      const privRef = makeKeyRef({ backendRef: privateKeyArmored });
      const pubRef = makeKeyRef({ backendRef: publicKeyArmored });

      const result = await service.verifyAndDecrypt(ciphertext, privRef, pubRef, {});
      expect(result.decryptedPayloadRef).toContain('decrypted/');
      expect(result.verificationResult).toBe('PASSED');
      expect(result.decryptMeta.operation).toBe('DECRYPT');
    });

    it('returns SKIPPED when no sender key provided', async () => {
      const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored });
      const message = await openpgp.createMessage({ text: 'unverified data' });
      const ciphertext = (await openpgp.encrypt({
        message,
        encryptionKeys: publicKey,
        format: 'armored',
      })) as string;

      const privRef = makeKeyRef({ backendRef: privateKeyArmored });
      const result = await service.verifyAndDecrypt(ciphertext, privRef, null, {});
      expect(result.verificationResult).toBe('SKIPPED');
    });
  });

  describe('policy enforcement', () => {
    it('rejects forbidden algorithm', async () => {
      const ref = makeKeyRef({ algorithm: 'dsa', backendRef: publicKeyArmored });
      await expect(
        service.encrypt(
          'payload',
          ref,
          { outputFormat: 'armored', compressionAlgorithm: 'zlib' },
          policy,
        ),
      ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.CRYPTO_UNSUPPORTED_ALGORITHM }));
    });

    it('rejects key in wrong state', async () => {
      const ref = makeKeyRef({ state: 'REVOKED', backendRef: publicKeyArmored });
      await expect(
        service.encrypt(
          'payload',
          ref,
          { outputFormat: 'armored', compressionAlgorithm: 'zlib' },
          policy,
        ),
      ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.CRYPTO_KEY_INVALID_STATE }));
    });
  });
});
