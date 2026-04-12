import { SepError, ErrorCode } from '@sep/common';
import { CryptoAlgorithmPolicy, KeyRef } from './interfaces';

/**
 * Enforce algorithm policy before any crypto operation.
 * Throws with CRYPTO_POLICY_VIOLATION (terminal) on any non-compliance.
 * Throws with CRYPTO_KEY_EXPIRED (terminal) on expired key.
 *
 * Must be called at the start of every crypto operation.
 */
export function enforcePolicy(
  policy: CryptoAlgorithmPolicy,
  keyRef: KeyRef,
  intendedAlgorithm: string,
  intendedCipher?: string,
  intendedHash?: string,
): void {
  // ── Expiry check — always first ────────────────────────────────────────────
  if (keyRef.expiresAt !== null && keyRef.expiresAt < new Date()) {
    throw new SepError(ErrorCode.CRYPTO_KEY_EXPIRED, {
      keyReferenceId: keyRef.keyReferenceId,
      expiredAt: keyRef.expiresAt.toISOString(),
    });
  }

  // ── Algorithm check ────────────────────────────────────────────────────────
  const normalizedAlgo = intendedAlgorithm.toLowerCase();
  if (!policy.allowedAlgorithms.includes(normalizedAlgo)) {
    throw new SepError(ErrorCode.CRYPTO_POLICY_VIOLATION, {
      keyReferenceId: keyRef.keyReferenceId,
      violatedRule: 'algorithm',
      provided: intendedAlgorithm,
      allowed: policy.allowedAlgorithms,
    });
  }

  // ── RSA minimum key size ───────────────────────────────────────────────────
  if (normalizedAlgo === 'rsa' && keyRef.algorithm.includes('2048')) {
    throw new SepError(ErrorCode.CRYPTO_POLICY_VIOLATION, {
      keyReferenceId: keyRef.keyReferenceId,
      violatedRule: 'minRsaKeySize',
      minRequired: policy.minRsaKeySize,
    });
  }

  // ── Cipher check ───────────────────────────────────────────────────────────
  if (intendedCipher !== undefined) {
    if (!policy.allowedCiphers.includes(intendedCipher.toLowerCase())) {
      throw new SepError(ErrorCode.CRYPTO_POLICY_VIOLATION, {
        keyReferenceId: keyRef.keyReferenceId,
        violatedRule: 'cipher',
        provided: intendedCipher,
        allowed: policy.allowedCiphers,
      });
    }
  }

  // ── Hash check ─────────────────────────────────────────────────────────────
  if (intendedHash !== undefined) {
    if (!policy.allowedHashes.includes(intendedHash.toLowerCase())) {
      throw new SepError(ErrorCode.CRYPTO_POLICY_VIOLATION, {
        keyReferenceId: keyRef.keyReferenceId,
        violatedRule: 'hash',
        provided: intendedHash,
        allowed: policy.allowedHashes,
      });
    }
  }
}
