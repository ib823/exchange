/**
 * Cryptographic service interface.
 *
 * All implementations MUST:
 * - Never log key material, passphrases, or plaintext payload content
 * - Fail closed on any unsupported operation or algorithm
 * - Record audit metadata for every operation (without sensitive content)
 * - Honour the approved algorithm policy — reject non-compliant profiles
 */

// ── Policy ─────────────────────────────────────────────────────────────────────
export interface CryptoAlgorithmPolicy {
  /** Approved public-key algorithms e.g. ['rsa', 'ecdh'] */
  allowedAlgorithms: string[];
  /** Approved symmetric ciphers e.g. ['aes256', 'aes128'] */
  allowedCiphers: string[];
  /** Approved hash algorithms e.g. ['sha256', 'sha512'] */
  allowedHashes: string[];
  /** Approved compression algorithms or 'none' */
  allowedCompressions: string[];
  /** Minimum RSA key size in bits */
  minRsaKeySize: number;
}

export const DEFAULT_ALGORITHM_POLICY: CryptoAlgorithmPolicy = {
  allowedAlgorithms: ['rsa', 'ecdh'],
  allowedCiphers: ['aes256', 'aes128'],
  allowedHashes: ['sha256', 'sha512'],
  allowedCompressions: ['zlib', 'none'],
  minRsaKeySize: 4096,
};

// ── Key material references ────────────────────────────────────────────────────
/** A reference to a key stored in the key backend — never the key itself */
export interface KeyRef {
  /** Key ID from key_references table */
  keyReferenceId: string;
  /** Backend reference (Vault path, KMS key ID) — used internally only */
  backendRef: string;
  /** Algorithm hint — used to select correct openpgp options */
  algorithm: string;
  /** Key lifecycle state — must be ACTIVE for any crypto operation */
  state: 'DRAFT' | 'IMPORTED' | 'VALIDATED' | 'ACTIVE' | 'ROTATING' | 'EXPIRED' | 'REVOKED' | 'RETIRED';
  /** Operations this key is authorised for */
  allowedUsages: Array<'ENCRYPT' | 'DECRYPT' | 'SIGN' | 'VERIFY'>;
  /** Revocation timestamp — if set, key must not be used */
  revokedAt: Date | null;
  /** Expiry — checked before any operation */
  expiresAt: Date | null;
  /** Environment — must match submission environment */
  environment: 'TEST' | 'CERTIFICATION' | 'PRODUCTION';
}

// ── Operation options ──────────────────────────────────────────────────────────
export interface EncryptOptions {
  outputFormat: 'armored' | 'binary';
  compressionAlgorithm: string;
  passwords?: never;         // Symmetric password encryption is not supported
}

export interface SignOptions {
  outputFormat: 'armored' | 'binary';
  detached: boolean;
}

export interface DecryptOptions {
  /** Optional: verify signature after decryption if sender key is provided */
  verifyWithKey?: KeyRef;
}

export interface VerifyOptions {
  /** For detached signatures: the original message payload ref */
  detached: boolean;
}

// ── Operation results ──────────────────────────────────────────────────────────
/** Returned by all crypto operations for audit logging */
export interface CryptoOperationMeta {
  operationId: string;
  operation: CryptoOperation;
  keyReferenceId: string;
  algorithmUsed: string;
  cipherUsed?: string;
  hashUsed: string;
  outputFormat: 'armored' | 'binary';
  inputSizeBytes: number;
  outputSizeBytes: number;
  durationMs: number;
  performedAt: Date;
}

export type CryptoOperation =
  | 'ENCRYPT'
  | 'DECRYPT'
  | 'SIGN'
  | 'VERIFY'
  | 'SIGN_ENCRYPT'
  | 'VERIFY_DECRYPT';

export interface EncryptResult {
  /** Object storage key where encrypted output is stored */
  encryptedPayloadRef: string;
  meta: CryptoOperationMeta;
}

export interface DecryptResult {
  /** Object storage key where decrypted output is stored */
  decryptedPayloadRef: string;
  /** Verification result if verifyWithKey was provided */
  verificationResult?: 'PASSED' | 'FAILED' | 'SKIPPED';
  meta: CryptoOperationMeta;
}

export interface SignResult {
  /** Object storage key where signed output (or detached sig) is stored */
  signedPayloadRef: string;
  /** Detached signature ref, populated only when options.detached === true */
  detachedSignatureRef?: string;
  meta: CryptoOperationMeta;
}

export interface VerifyResult {
  verified: boolean;
  signerKeyFingerprint?: string;
  signedAt?: Date;
  meta: CryptoOperationMeta;
}

export interface SignEncryptResult {
  securedPayloadRef: string;
  signMeta: CryptoOperationMeta;
  encryptMeta: CryptoOperationMeta;
}

export interface VerifyDecryptResult {
  decryptedPayloadRef: string;
  verificationResult: 'PASSED' | 'FAILED' | 'SKIPPED';
  signMeta?: CryptoOperationMeta;
  decryptMeta: CryptoOperationMeta;
}

// ── Service interface ──────────────────────────────────────────────────────────
export interface ICryptoService {
  /**
   * Encrypt payload for a recipient.
   * Fails closed if recipient key is expired or algorithm is not in policy.
   */
  encrypt(
    payloadRef: string,
    recipientKey: KeyRef,
    options: EncryptOptions,
    policy: CryptoAlgorithmPolicy,
  ): Promise<EncryptResult>;

  /**
   * Decrypt a ciphertext.
   * Fails closed if the private key reference cannot be resolved.
   */
  decrypt(
    encryptedPayloadRef: string,
    privateKeyRef: KeyRef,
    options: DecryptOptions,
  ): Promise<DecryptResult>;

  /**
   * Sign a payload.
   * Fails closed if the signing key is expired or revoked.
   */
  sign(
    payloadRef: string,
    signingKeyRef: KeyRef,
    options: SignOptions,
    policy: CryptoAlgorithmPolicy,
  ): Promise<SignResult>;

  /**
   * Verify a signature.
   * Returns verified: false (does NOT throw) on mismatch — caller decides action.
   * Audit event is always recorded regardless of result.
   */
  verify(
    payloadRef: string,
    senderPublicKeyRef: KeyRef,
    options: VerifyOptions,
  ): Promise<VerifyResult>;

  /** Sign then encrypt — the standard outbound bank file operation */
  signAndEncrypt(
    payloadRef: string,
    signingKeyRef: KeyRef,
    recipientKey: KeyRef,
    signOptions: SignOptions,
    encryptOptions: EncryptOptions,
    policy: CryptoAlgorithmPolicy,
  ): Promise<SignEncryptResult>;

  /** Verify signature and decrypt — the standard inbound bank ack operation */
  verifyAndDecrypt(
    securedPayloadRef: string,
    privateKeyRef: KeyRef,
    senderPublicKeyRef: KeyRef | null,
    options: DecryptOptions,
  ): Promise<VerifyDecryptResult>;
}

// ── Key fingerprint utility ────────────────────────────────────────────────────
export interface KeyFingerprint {
  fingerprint: string;
  algorithm: string;
  keyId: string;
  createdAt: Date;
}
