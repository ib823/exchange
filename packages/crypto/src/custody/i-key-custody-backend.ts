/**
 * Key custody backend contract (M3.A5-T01).
 *
 * All key material lives in a backend (Vault today, KMS or
 * software-local in the future). Every cryptographic operation that
 * touches private material MUST go through a backend. Direct reads
 * of backendRef outside this contract are forbidden.
 *
 * Backends MUST:
 * - Never log, return, or persist key material in error paths.
 * - Fail closed: transient errors throw SepError(KEY_BACKEND_UNAVAILABLE);
 *   missing-backend / not-approved cases throw terminal errors from the
 *   CRYPTO_BACKEND_* family.
 * - Zeroise any in-process copies of private key material immediately
 *   after an operation completes (success OR failure path).
 *
 * OpenPGP interop note: the M3 implementations read armored key
 * material from Vault KV v2 and delegate the cryptographic op to
 * openpgp.js in-process. Vault's transit engine is reserved for
 * non-PGP uses (e.g., M3.A4 MFA secret encryption) because its output
 * envelope (`vault:v1:…`) is not RFC 9580 compatible.
 */

import type { KeyBackendType } from './key-reference-input';

/** Armored (ASCII-armored) OpenPGP key blob — `-----BEGIN PGP …-----` framed */
export type ArmoredKey = string & { readonly __brand: 'ArmoredKey' };

/** Armored or binary OpenPGP signature output */
export type Signature = string & { readonly __brand: 'Signature' };

/** Armored OpenPGP ciphertext */
export type Ciphertext = string & { readonly __brand: 'Ciphertext' };

/** Plaintext buffer — caller is responsible for zeroising after use */
export type Plaintext = Buffer;

/**
 * Minimum KeyReference shape the backend needs. Mirrors the Prisma
 * KeyReference model without pulling the DB type into the crypto
 * package (crypto must stay framework-free).
 */
export interface KeyReferenceInput {
  readonly id: string;
  readonly tenantId: string;
  readonly backendType: KeyBackendType;
  readonly backendRef: string;
  readonly algorithm: string;
  readonly fingerprint: string;
}

/**
 * Rotation produces a new backend reference (Vault key version bump,
 * KMS new key ID). Callers must persist the new reference on the
 * KeyReference row in the same transaction as the rotation audit.
 */
export interface RotationResult {
  readonly newBackendRef: string;
  readonly newFingerprint: string;
  readonly rotatedAt: Date;
}

/**
 * The 8-operation contract. All backends implement every method;
 * interface-only backends throw a typed CRYPTO_BACKEND_* error from
 * each method, never a generic Error. Backends that cannot honor a
 * specific operation class (e.g. cloud KMS that cannot express an
 * in-process composite sign-then-encrypt) throw
 * CRYPTO_OPERATION_NOT_SUPPORTED from that method.
 */
export interface IKeyCustodyBackend {
  /** Return the armored public key for this reference. Safe to log fingerprint only. */
  getPublicKey(ref: KeyReferenceInput): Promise<ArmoredKey>;

  /** Produce a detached OpenPGP signature over payload using the private key at ref. */
  signDetached(ref: KeyReferenceInput, payload: Buffer): Promise<Signature>;

  /** Verify a detached signature against the public key at ref. Returns true/false; never throws on mismatch. */
  verifyDetached(ref: KeyReferenceInput, payload: Buffer, signature: Signature): Promise<boolean>;

  /** Decrypt OpenPGP ciphertext using the private key at ref. */
  decrypt(ref: KeyReferenceInput, ciphertext: Ciphertext): Promise<Plaintext>;

  /** Encrypt plaintext for the recipient public key at ref. */
  encryptForRecipient(ref: KeyReferenceInput, plaintext: Plaintext): Promise<Ciphertext>;

  /**
   * Atomic sign-then-encrypt. Produces an OpenPGP message signed by
   * the private key at `signingKeyRef` and encrypted to the recipient
   * public key at `recipientKeyRef`.
   *
   * Called only when both refs resolve to the same backend. The
   * backend loads both keys in-process, performs the composite op via
   * openpgp.js (RFC 9580 sign-then-encrypt is atomic at the openpgp.js
   * boundary — the signing key must be in scope at encrypt time), then
   * zeroises any private-material buffers it allocated.
   *
   * The same-backend precondition is enforced by the dispatcher layer
   * (KeyCustodyAbstraction), NOT here — backends do not cross-check
   * refs against themselves. A backend whose design cannot support
   * composite ops (e.g. a cloud KMS that cannot hold two key handles
   * simultaneously) throws CRYPTO_OPERATION_NOT_SUPPORTED.
   */
  signAndEncrypt(
    signingKeyRef: KeyReferenceInput,
    recipientKeyRef: KeyReferenceInput,
    plaintext: Plaintext,
  ): Promise<Ciphertext>;

  /** Rotate the key at ref. Returns the new backendRef + fingerprint for persistence. */
  rotate(ref: KeyReferenceInput): Promise<RotationResult>;

  /** Mark the key at ref as revoked in the backend. Idempotent. */
  revoke(ref: KeyReferenceInput): Promise<void>;
}
