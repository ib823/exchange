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
 *
 * `usage` is the authorised operation list copied from the DB row.
 * It is not used by the backend itself (backends don't enforce
 * authorisation) — the dispatcher layer reads it for composite-op
 * purpose guards. See KeyCustodyAbstraction.dispatchSignAndEncrypt
 * for the check that fires CRYPTO_KEY_PURPOSE_MISMATCH when a
 * caller passes the wrong-role key (e.g. a signing key as the
 * encryption recipient).
 */
export interface KeyReferenceInput {
  readonly id: string;
  readonly tenantId: string;
  readonly backendType: KeyBackendType;
  readonly backendRef: string;
  readonly algorithm: string;
  readonly fingerprint: string;
  readonly usage: readonly KeyUsage[];
}

/**
 * Authorised operations for a key. Mirrors the values the platform
 * writes into `KeyReference.usage: String[]` — ENCRYPT for encryption
 * recipients, DECRYPT for our own decryption private keys, SIGN for
 * our own signing private keys, VERIFY for partner verification
 * public keys. A real production key has exactly one of
 * {SIGN, ENCRYPT} on the private-key side; the array form is kept for
 * schema compatibility and does not imply multi-purpose is approved.
 */
export type KeyUsage = 'ENCRYPT' | 'DECRYPT' | 'SIGN' | 'VERIFY';

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
 * Output of the composite decrypt-then-verify op. Plaintext is a
 * Buffer (caller zeroises when done). `signatureValid` is the
 * openpgp.js verification outcome on any embedded signature in the
 * ciphertext; false if the ciphertext carried no signature, or if
 * verification threw.
 */
export interface DecryptVerifyResult {
  readonly plaintext: Plaintext;
  readonly signatureValid: boolean;
  readonly signerKeyId: string;
}

/**
 * The 10-operation V1 contract. All backends implement every method;
 * interface-only backends throw a typed CRYPTO_BACKEND_* error from
 * each method, never a generic Error. Backends that cannot honor a
 * specific operation class (e.g. cloud KMS that cannot express an
 * in-process composite sign-then-encrypt) throw
 * CRYPTO_OPERATION_NOT_SUPPORTED from that method.
 *
 * Single-ref ops: getPublicKey, signDetached, signInline,
 * verifyDetached, decrypt, encryptForRecipient, rotate, revoke.
 *
 * Composite ops (`signAndEncrypt`, `decryptAndVerify`) require two
 * keys to be in scope on the same in-process openpgp.js call —
 * RFC 9580 sign-then-encrypt and its inverse decrypt-then-verify
 * are atomic at the openpgp.js boundary. Both composites are
 * dispatched under a same-backend precondition enforced by
 * KeyCustodyAbstraction.
 *
 * V2 trajectory: the method surface is large and grew during M3.A5
 * execution (signAndEncrypt, decryptAndVerify, signInline added
 * after the initial 7-method sketch). ADR-0007 records the
 * generalization plan — a tagged-union KeyOperation descriptor +
 * `perform(op)` method — and the trigger for cutting over.
 */
export interface IKeyCustodyBackend {
  /** Return the armored public key for this reference. Safe to log fingerprint only. */
  getPublicKey(ref: KeyReferenceInput): Promise<ArmoredKey>;

  /** Produce a detached OpenPGP signature over payload using the private key at ref. */
  signDetached(ref: KeyReferenceInput, payload: Buffer): Promise<Signature>;

  /**
   * Produce an inline-signed armored OpenPGP MESSAGE block: payload
   * and signature combined into a single RFC 9580 message (the output
   * of `openpgp.sign({ detached: false })`).
   *
   * Like `signDetached`, this is a single-key op — the signing
   * private key is loaded into the backend's process, used for the
   * openpgp.sign call, and zeroised before returning. The output is
   * returned as `Ciphertext` because the armored-MESSAGE brand covers
   * signed-but-unencrypted messages too (RFC 9580 does not distinguish
   * the armor header). Callers that need the embedded payload extract
   * it via openpgp.readMessage + openpgp.verify.
   */
  signInline(ref: KeyReferenceInput, payload: Buffer): Promise<Ciphertext>;

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

  /**
   * Atomic decrypt-then-verify. Decrypts an OpenPGP message signed
   * by `senderKeyRef` and encrypted to `decryptionKeyRef`, returning
   * the plaintext together with the embedded-signature verification
   * outcome.
   *
   * Called only when both refs resolve to the same backend. Symmetric
   * to `signAndEncrypt`: the backend loads the decryption private key
   * + sender public key in-process, performs the composite op via
   * openpgp.js (decrypt + verify must see both keys in the same call),
   * zeroises private-material buffers, and returns the result.
   *
   * Same-backend precondition is enforced by the dispatcher layer,
   * NOT here. Backends that cannot honor composite ops throw
   * CRYPTO_OPERATION_NOT_SUPPORTED.
   */
  decryptAndVerify(
    decryptionKeyRef: KeyReferenceInput,
    senderKeyRef: KeyReferenceInput,
    ciphertext: Ciphertext,
  ): Promise<DecryptVerifyResult>;

  /** Rotate the key at ref. Returns the new backendRef + fingerprint for persistence. */
  rotate(ref: KeyReferenceInput): Promise<RotationResult>;

  /** Mark the key at ref as revoked in the backend. Idempotent. */
  revoke(ref: KeyReferenceInput): Promise<void>;
}
