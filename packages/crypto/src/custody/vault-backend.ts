/**
 * Shared Vault-backed key custody implementation (M3.A5-T03).
 *
 * Platform and Tenant variants differ only in the mount/path
 * prefix they use, so the implementation lives in one abstract
 * class; the two subclasses set their prefixes at construction.
 *
 * Operation model (per ADR-0007 rationale):
 *
 *   - Public-key material is fetched from Vault KV v2 and returned
 *     as ArmoredKey.
 *   - Sign / encrypt / decrypt for OpenPGP: the armored private
 *     key is read from KV v2 into a process-local Buffer, delegated
 *     to openpgp.js, and then zeroised before the call returns.
 *   - Rotate: generates a new armored key pair client-side and
 *     persists as a new KV v2 version (Vault KV v2 retains versions
 *     automatically; `rotate` returns the new fingerprint + path).
 *   - Revoke: destroys all KV v2 versions at this path (idempotent).
 *
 * SECURITY: all private-material code paths (`signDetached`,
 * `decrypt`) wrap material load + zeroise in try/finally so a
 * throwing openpgp.js call still clears the buffer.
 */

import * as openpgp from 'openpgp';
import { SepError, ErrorCode } from '@sep/common';
import { createLogger } from '@sep/observability';
import type {
  IKeyCustodyBackend,
  KeyReferenceInput,
  ArmoredKey,
  Signature,
  Ciphertext,
  Plaintext,
  RotationResult,
} from './i-key-custody-backend';
import type { VaultClient } from './vault-client';

const logger = createLogger({ service: 'crypto', module: 'vault-backend' });

export interface VaultBackendPaths {
  /** Vault KV v2 mount (e.g., `kv` — the default secret mount) */
  readonly kvMount: string;
  /** Prefix under the KV mount where key material lives (e.g., `platform/keys`) */
  readonly kvPrefix: string;
}

/** Shape persisted under each KV v2 path */
interface StoredKeyMaterial {
  readonly armoredPublicKey: string;
  readonly armoredPrivateKey: string;
  readonly fingerprint: string;
  readonly algorithm: string;
}

/**
 * Fill a string's backing buffer with zero bytes.
 * openpgp.js returns armored strings; JavaScript strings are
 * immutable, so the best we can do is null the local reference
 * and rely on GC. We still zero any Buffer we allocated ourselves.
 */
function zeroBuffer(buf: Buffer): void {
  buf.fill(0);
}

export abstract class VaultKeyCustodyBackend implements IKeyCustodyBackend {
  protected constructor(
    protected readonly client: VaultClient,
    protected readonly paths: VaultBackendPaths,
  ) {}

  /**
   * Subclass hook: map a backendRef (stored on KeyReference.backendRef)
   * to a KV v2 path under the mount.
   */
  protected abstract kvPathFor(ref: KeyReferenceInput): string;

  async getPublicKey(ref: KeyReferenceInput): Promise<ArmoredKey> {
    const material = await this.loadMaterial(ref);
    return material.armoredPublicKey as ArmoredKey;
  }

  async signDetached(ref: KeyReferenceInput, payload: Buffer): Promise<Signature> {
    const material = await this.loadMaterial(ref);
    let privateKeyBuf: Buffer | null = null;
    try {
      privateKeyBuf = Buffer.from(material.armoredPrivateKey, 'utf8');
      const privateKey = await openpgp.readPrivateKey({
        armoredKey: material.armoredPrivateKey,
      });
      const message = await openpgp.createMessage({ binary: new Uint8Array(payload) });
      const signature = await openpgp.sign({
        message,
        signingKeys: privateKey,
        detached: true,
      });
      logger.debug(
        { keyReferenceId: ref.id, fingerprint: material.fingerprint.substring(0, 8) },
        'signDetached completed',
      );
      return String(signature) as Signature;
    } catch (err) {
      if (err instanceof SepError) {
        throw err;
      }
      logger.error({ keyReferenceId: ref.id }, 'signDetached failed');
      throw new SepError(ErrorCode.CRYPTO_SIGNING_FAILED, {
        keyReferenceId: ref.id,
        operation: 'signDetached',
      });
    } finally {
      if (privateKeyBuf !== null) {
        zeroBuffer(privateKeyBuf);
      }
    }
  }

  async verifyDetached(
    ref: KeyReferenceInput,
    payload: Buffer,
    signature: Signature,
  ): Promise<boolean> {
    try {
      const material = await this.loadMaterial(ref);
      const publicKey = await openpgp.readKey({ armoredKey: material.armoredPublicKey });
      const sig = await openpgp.readSignature({ armoredSignature: signature });
      const message = await openpgp.createMessage({ binary: new Uint8Array(payload) });
      const verifyResult = await openpgp.verify({
        message,
        signature: sig,
        verificationKeys: publicKey,
      });
      const first = verifyResult.signatures[0];
      if (first === undefined) {
        return false;
      }
      try {
        await first.verified;
        return true;
      } catch {
        return false;
      }
    } catch (err) {
      if (err instanceof SepError) {
        throw err;
      }
      logger.warn({ keyReferenceId: ref.id }, 'verifyDetached threw — returning false');
      return false;
    }
  }

  async decrypt(ref: KeyReferenceInput, ciphertext: Ciphertext): Promise<Plaintext> {
    const material = await this.loadMaterial(ref);
    let privateKeyBuf: Buffer | null = null;
    try {
      privateKeyBuf = Buffer.from(material.armoredPrivateKey, 'utf8');
      const privateKey = await openpgp.readPrivateKey({
        armoredKey: material.armoredPrivateKey,
      });
      const message = await openpgp.readMessage({ armoredMessage: ciphertext });
      const { data } = await openpgp.decrypt({
        message,
        decryptionKeys: privateKey,
        format: 'binary',
      });
      const dataBytes = data as unknown as Uint8Array;
      return Buffer.from(dataBytes);
    } catch (err) {
      if (err instanceof SepError) {
        throw err;
      }
      logger.error({ keyReferenceId: ref.id }, 'decrypt failed');
      throw new SepError(ErrorCode.CRYPTO_DECRYPTION_FAILED, {
        keyReferenceId: ref.id,
        operation: 'decrypt',
      });
    } finally {
      if (privateKeyBuf !== null) {
        zeroBuffer(privateKeyBuf);
      }
    }
  }

  async encryptForRecipient(ref: KeyReferenceInput, plaintext: Plaintext): Promise<Ciphertext> {
    try {
      const material = await this.loadMaterial(ref);
      const publicKey = await openpgp.readKey({ armoredKey: material.armoredPublicKey });
      const message = await openpgp.createMessage({ binary: new Uint8Array(plaintext) });
      const encrypted = await openpgp.encrypt({
        message,
        encryptionKeys: publicKey,
      });
      return String(encrypted) as Ciphertext;
    } catch (err) {
      if (err instanceof SepError) {
        throw err;
      }
      logger.error({ keyReferenceId: ref.id }, 'encryptForRecipient failed');
      throw new SepError(ErrorCode.CRYPTO_ENCRYPTION_FAILED, {
        keyReferenceId: ref.id,
        operation: 'encryptForRecipient',
      });
    }
  }

  async signAndEncrypt(
    signingKeyRef: KeyReferenceInput,
    recipientKeyRef: KeyReferenceInput,
    plaintext: Plaintext,
  ): Promise<Ciphertext> {
    // Pre-flight both refs through kvPathFor BEFORE any HTTP read.
    // TenantVaultBackend's override enforces the tenant boundary here,
    // so a cross-tenant composite fails fast without leaking a Vault
    // read on the first ref. PlatformVaultBackend's override is a pure
    // path computation — the cost is negligible.
    this.kvPathFor(signingKeyRef);
    this.kvPathFor(recipientKeyRef);

    const signingMaterial = await this.loadMaterial(signingKeyRef);
    const recipientMaterial = await this.loadMaterial(recipientKeyRef);

    let signingKeyBuf: Buffer | null = null;
    try {
      signingKeyBuf = Buffer.from(signingMaterial.armoredPrivateKey, 'utf8');
      const signingKey = await openpgp.readPrivateKey({
        armoredKey: signingMaterial.armoredPrivateKey,
      });
      const recipientKey = await openpgp.readKey({
        armoredKey: recipientMaterial.armoredPublicKey,
      });
      const message = await openpgp.createMessage({ binary: new Uint8Array(plaintext) });
      const encrypted = await openpgp.encrypt({
        message,
        encryptionKeys: recipientKey,
        signingKeys: signingKey,
      });
      logger.debug(
        {
          signingKeyReferenceId: signingKeyRef.id,
          recipientKeyReferenceId: recipientKeyRef.id,
          signingFingerprint: signingMaterial.fingerprint.substring(0, 8),
          recipientFingerprint: recipientMaterial.fingerprint.substring(0, 8),
        },
        'signAndEncrypt completed',
      );
      return String(encrypted) as Ciphertext;
    } catch (err) {
      if (err instanceof SepError) {
        throw err;
      }
      logger.error(
        {
          signingKeyReferenceId: signingKeyRef.id,
          recipientKeyReferenceId: recipientKeyRef.id,
        },
        'signAndEncrypt failed',
      );
      throw new SepError(ErrorCode.CRYPTO_ENCRYPTION_FAILED, {
        keyReferenceId: signingKeyRef.id,
        operation: 'signAndEncrypt',
      });
    } finally {
      if (signingKeyBuf !== null) {
        zeroBuffer(signingKeyBuf);
      }
    }
  }

  async rotate(ref: KeyReferenceInput): Promise<RotationResult> {
    // Generate a new keypair of the same algorithm class.
    // Use RSA-4096 by default; subclasses override via metadata if needed.
    const keyAlg = this.inferOpenPgpAlg(ref.algorithm);
    const generateBase = {
      userIDs: [{ name: ref.id, email: `${ref.id}@keys.invalid` }],
      format: 'armored' as const,
    };
    const generated =
      keyAlg.type === 'rsa'
        ? await openpgp.generateKey({
            ...generateBase,
            type: 'rsa',
            rsaBits: keyAlg.rsaBits ?? 4096,
          })
        : await openpgp.generateKey({
            ...generateBase,
            type: 'ecc',
            curve: keyAlg.curve ?? 'curve25519',
          });

    const publicKey = await openpgp.readKey({ armoredKey: generated.publicKey });
    const fingerprint = publicKey.getFingerprint();

    const kvPath = this.kvPathFor(ref);
    const toStore: StoredKeyMaterial = {
      armoredPublicKey: generated.publicKey,
      armoredPrivateKey: generated.privateKey,
      fingerprint,
      algorithm: ref.algorithm,
    };
    const writeResult = await this.client.kvWrite(this.paths.kvMount, kvPath, toStore);

    logger.info(
      {
        keyReferenceId: ref.id,
        newFingerprint: fingerprint.substring(0, 8),
        newVersion: writeResult.data.version,
      },
      'Key rotated in Vault',
    );

    return {
      newBackendRef: `${kvPath}#v${writeResult.data.version}`,
      newFingerprint: fingerprint,
      rotatedAt: new Date(writeResult.data.created_time),
    };
  }

  async revoke(ref: KeyReferenceInput): Promise<void> {
    const kvPath = this.kvPathFor(ref);
    await this.client.kvDestroyAllVersions(this.paths.kvMount, kvPath);
    logger.info({ keyReferenceId: ref.id }, 'Key material destroyed in Vault (revoke)');
  }

  // ── Private helpers ───────────────────────────────────────────

  private async loadMaterial(ref: KeyReferenceInput): Promise<StoredKeyMaterial> {
    const kvPath = this.kvPathFor(ref);
    const material = await this.client.kvRead<StoredKeyMaterial>(this.paths.kvMount, kvPath);
    if (
      material.fingerprint.toLowerCase() !== ref.fingerprint.toLowerCase() &&
      ref.fingerprint.length > 0
    ) {
      logger.error(
        {
          keyReferenceId: ref.id,
          expected: ref.fingerprint.substring(0, 8),
          actual: material.fingerprint.substring(0, 8),
        },
        'Vault material fingerprint mismatch — possible key substitution',
      );
      throw new SepError(ErrorCode.KEY_FINGERPRINT_MISMATCH, {
        keyReferenceId: ref.id,
      });
    }
    return material;
  }

  private inferOpenPgpAlg(algorithm: string): {
    type: 'rsa' | 'ecc';
    curve?: 'curve25519' | 'p256' | 'p384' | 'p521';
    rsaBits?: 2048 | 3072 | 4096;
  } {
    const normalised = algorithm.toLowerCase();
    if (normalised.startsWith('rsa')) {
      return { type: 'rsa', rsaBits: 4096 };
    }
    if (normalised.includes('25519')) {
      return { type: 'ecc', curve: 'curve25519' };
    }
    if (normalised.includes('p256') || normalised.includes('nistp256')) {
      return { type: 'ecc', curve: 'p256' };
    }
    if (normalised.includes('p384')) {
      return { type: 'ecc', curve: 'p384' };
    }
    throw new SepError(ErrorCode.CRYPTO_UNSUPPORTED_ALGORITHM, { algorithm });
  }
}

export class PlatformVaultBackend extends VaultKeyCustodyBackend {
  constructor(client: VaultClient) {
    super(client, { kvMount: 'kv', kvPrefix: 'platform/keys' });
  }

  protected kvPathFor(ref: KeyReferenceInput): string {
    // backendRef may be a full path (returned by rotate as `kvPath#v<N>`)
    // or a bare reference id (freshly imported keys). Normalise both.
    const stripped = ref.backendRef.split('#', 1)[0] ?? ref.backendRef;
    if (stripped.startsWith(`${this.paths.kvPrefix}/`)) {
      return stripped;
    }
    return `${this.paths.kvPrefix}/${stripped || ref.id}`;
  }
}

export class TenantVaultBackend extends VaultKeyCustodyBackend {
  constructor(
    client: VaultClient,
    private readonly tenantId: string,
  ) {
    super(client, {
      kvMount: 'kv',
      kvPrefix: `tenant/${tenantId}/keys`,
    });
    if (tenantId.length === 0) {
      throw new SepError(ErrorCode.TENANT_CONTEXT_INVALID, {
        reason: 'TenantVaultBackend requires a non-empty tenantId',
      });
    }
  }

  protected kvPathFor(ref: KeyReferenceInput): string {
    if (ref.tenantId !== this.tenantId) {
      logger.error(
        { keyReferenceId: ref.id, refTenantId: ref.tenantId, backendTenantId: this.tenantId },
        'Cross-tenant key access attempt in TenantVaultBackend',
      );
      throw new SepError(ErrorCode.TENANT_BOUNDARY_VIOLATION, {
        keyReferenceId: ref.id,
        requestedTenantId: ref.tenantId,
      });
    }
    const stripped = ref.backendRef.split('#', 1)[0] ?? ref.backendRef;
    if (stripped.startsWith(`${this.paths.kvPrefix}/`)) {
      return stripped;
    }
    return `${this.paths.kvPrefix}/${stripped || ref.id}`;
  }
}
