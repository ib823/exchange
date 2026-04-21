/**
 * Interface-only backends (M3.A5-T04; composite coverage added in
 * T05b-pre and T05c).
 *
 * Every IKeyCustodyBackend method throws a typed SepError so dispatch
 * failures surface as fail-closed terminal errors rather than silent
 * drops. The single-ref methods throw CRYPTO_BACKEND_{NOT_IMPLEMENTED,
 * NOT_AVAILABLE} (the backend class is not wired for production at
 * all). The composite ops (`signAndEncrypt`, `decryptAndVerify`) throw
 * CRYPTO_OPERATION_NOT_SUPPORTED instead — a distinct failure mode
 * reserved for backends that are wired but cannot honor an operation
 * class; stubs emit it to make conformance assertions precise.
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
  DecryptVerifyResult,
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

const COMPOSITE_UNSUPPORTED_EXTERNAL_KMS =
  'External KMS cannot hold two key handles in-process for composite ops; route composite ops to a Vault backend';

const COMPOSITE_UNSUPPORTED_SOFTWARE_LOCAL =
  'Software-local backend is not approved for composite ops; route composite ops to a Vault backend';

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
  async signInline(ref: KeyReferenceInput, _payload: Buffer): Promise<Ciphertext> {
    // signInline could have been a composite-style CRYPTO_OPERATION_
    // NOT_SUPPORTED, but semantically it's a single-key op that this
    // backend simply hasn't wired — same category as signDetached.
    return notImplemented('EXTERNAL_KMS', 'signInline', ref);
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
  async signAndEncrypt(
    signingKeyRef: KeyReferenceInput,
    recipientKeyRef: KeyReferenceInput,
    _plaintext: Plaintext,
  ): Promise<Ciphertext> {
    throw new SepError(ErrorCode.CRYPTO_OPERATION_NOT_SUPPORTED, {
      backendType: 'EXTERNAL_KMS',
      operation: 'signAndEncrypt',
      signingKeyReferenceId: signingKeyRef.id,
      recipientKeyReferenceId: recipientKeyRef.id,
      reason: COMPOSITE_UNSUPPORTED_EXTERNAL_KMS,
    });
  }
  async decryptAndVerify(
    decryptionKeyRef: KeyReferenceInput,
    senderKeyRef: KeyReferenceInput,
    _ciphertext: Ciphertext,
  ): Promise<DecryptVerifyResult> {
    throw new SepError(ErrorCode.CRYPTO_OPERATION_NOT_SUPPORTED, {
      backendType: 'EXTERNAL_KMS',
      operation: 'decryptAndVerify',
      decryptionKeyReferenceId: decryptionKeyRef.id,
      senderKeyReferenceId: senderKeyRef.id,
      reason: COMPOSITE_UNSUPPORTED_EXTERNAL_KMS,
    });
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
  async signInline(ref: KeyReferenceInput, _payload: Buffer): Promise<Ciphertext> {
    return notAvailable('SOFTWARE_LOCAL', 'signInline', ref);
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
  async signAndEncrypt(
    signingKeyRef: KeyReferenceInput,
    recipientKeyRef: KeyReferenceInput,
    _plaintext: Plaintext,
  ): Promise<Ciphertext> {
    throw new SepError(ErrorCode.CRYPTO_OPERATION_NOT_SUPPORTED, {
      backendType: 'SOFTWARE_LOCAL',
      operation: 'signAndEncrypt',
      signingKeyReferenceId: signingKeyRef.id,
      recipientKeyReferenceId: recipientKeyRef.id,
      reason: COMPOSITE_UNSUPPORTED_SOFTWARE_LOCAL,
    });
  }
  async decryptAndVerify(
    decryptionKeyRef: KeyReferenceInput,
    senderKeyRef: KeyReferenceInput,
    _ciphertext: Ciphertext,
  ): Promise<DecryptVerifyResult> {
    throw new SepError(ErrorCode.CRYPTO_OPERATION_NOT_SUPPORTED, {
      backendType: 'SOFTWARE_LOCAL',
      operation: 'decryptAndVerify',
      decryptionKeyReferenceId: decryptionKeyRef.id,
      senderKeyReferenceId: senderKeyRef.id,
      reason: COMPOSITE_UNSUPPORTED_SOFTWARE_LOCAL,
    });
  }
  async rotate(ref: KeyReferenceInput): Promise<RotationResult> {
    return notAvailable('SOFTWARE_LOCAL', 'rotate', ref);
  }
  async revoke(ref: KeyReferenceInput): Promise<void> {
    return notAvailable('SOFTWARE_LOCAL', 'revoke', ref);
  }
}
