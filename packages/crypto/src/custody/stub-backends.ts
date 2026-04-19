/**
 * Interface-only backends (M3.A5-T04).
 *
 * Each of the 7 IKeyCustodyBackend methods throws a typed SepError
 * from the CRYPTO_BACKEND_* family so dispatch failures surface as
 * fail-closed terminal errors rather than silent drops.
 */

/* eslint-disable @typescript-eslint/require-await -- stub backends throw synchronously by contract; `async` keeps signatures aligned with IKeyCustodyBackend */

import { SepError, ErrorCode } from '@sep/common';
import type {
  IKeyCustodyBackend,
  KeyReferenceInput,
  ArmoredKey,
  Signature,
  Ciphertext,
  Plaintext,
  RotationResult,
} from './i-key-custody-backend';

type BackendName = 'EXTERNAL_KMS' | 'SOFTWARE_LOCAL';

function notImplemented(backend: BackendName, method: string, ref: KeyReferenceInput): never {
  throw new SepError(ErrorCode.CRYPTO_BACKEND_NOT_IMPLEMENTED, {
    backendType: backend,
    operation: method,
    keyReferenceId: ref.id,
    reason:
      backend === 'EXTERNAL_KMS'
        ? 'External KMS backend deferred to M5 or first AWS-tier customer'
        : 'Software-local backend not approved for production; use Vault',
  });
}

function notAvailable(backend: BackendName, method: string, ref: KeyReferenceInput): never {
  throw new SepError(ErrorCode.CRYPTO_BACKEND_NOT_AVAILABLE, {
    backendType: backend,
    operation: method,
    keyReferenceId: ref.id,
    reason: 'Software-local backend not approved for production; use Vault',
  });
}

/**
 * External KMS backend — interface-only in M3. Concrete wiring
 * lands at M5 or at the first AWS-tier customer, whichever is
 * sooner. Every method throws CRYPTO_BACKEND_NOT_IMPLEMENTED.
 */
export class ExternalKmsBackend implements IKeyCustodyBackend {
  async getPublicKey(ref: KeyReferenceInput): Promise<ArmoredKey> {
    return notImplemented('EXTERNAL_KMS', 'getPublicKey', ref);
  }
  async signDetached(ref: KeyReferenceInput, _payload: Buffer): Promise<Signature> {
    return notImplemented('EXTERNAL_KMS', 'signDetached', ref);
  }
  async verifyDetached(
    ref: KeyReferenceInput,
    _payload: Buffer,
    _signature: Signature,
  ): Promise<boolean> {
    return notImplemented('EXTERNAL_KMS', 'verifyDetached', ref);
  }
  async decrypt(ref: KeyReferenceInput, _ciphertext: Ciphertext): Promise<Plaintext> {
    return notImplemented('EXTERNAL_KMS', 'decrypt', ref);
  }
  async encryptForRecipient(ref: KeyReferenceInput, _plaintext: Plaintext): Promise<Ciphertext> {
    return notImplemented('EXTERNAL_KMS', 'encryptForRecipient', ref);
  }
  async rotate(ref: KeyReferenceInput): Promise<RotationResult> {
    return notImplemented('EXTERNAL_KMS', 'rotate', ref);
  }
  async revoke(ref: KeyReferenceInput): Promise<void> {
    return notImplemented('EXTERNAL_KMS', 'revoke', ref);
  }
}

/**
 * Software-local backend — interface-only. Explicit fail-closed path
 * so a stray `backendType: SOFTWARE_LOCAL` in the database cannot be
 * used to process production material. Every method throws
 * CRYPTO_BACKEND_NOT_AVAILABLE.
 */
export class SoftwareLocalBackend implements IKeyCustodyBackend {
  async getPublicKey(ref: KeyReferenceInput): Promise<ArmoredKey> {
    return notAvailable('SOFTWARE_LOCAL', 'getPublicKey', ref);
  }
  async signDetached(ref: KeyReferenceInput, _payload: Buffer): Promise<Signature> {
    return notAvailable('SOFTWARE_LOCAL', 'signDetached', ref);
  }
  async verifyDetached(
    ref: KeyReferenceInput,
    _payload: Buffer,
    _signature: Signature,
  ): Promise<boolean> {
    return notAvailable('SOFTWARE_LOCAL', 'verifyDetached', ref);
  }
  async decrypt(ref: KeyReferenceInput, _ciphertext: Ciphertext): Promise<Plaintext> {
    return notAvailable('SOFTWARE_LOCAL', 'decrypt', ref);
  }
  async encryptForRecipient(ref: KeyReferenceInput, _plaintext: Plaintext): Promise<Ciphertext> {
    return notAvailable('SOFTWARE_LOCAL', 'encryptForRecipient', ref);
  }
  async rotate(ref: KeyReferenceInput): Promise<RotationResult> {
    return notAvailable('SOFTWARE_LOCAL', 'rotate', ref);
  }
  async revoke(ref: KeyReferenceInput): Promise<void> {
    return notAvailable('SOFTWARE_LOCAL', 'revoke', ref);
  }
}
