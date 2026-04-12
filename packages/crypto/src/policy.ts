import { SepError, ErrorCode } from '@sep/common';
import { CryptoAlgorithmPolicy, KeyRef } from './interfaces';

/**
 * Enforce algorithm policy and key validity before any crypto operation.
 *
 * Checks in order (all terminal errors — non-retryable):
 * 1. Key state must be ACTIVE
 * 2. Key must not be revoked
 * 3. Environment must match submission environment
 * 4. Key usage must include the intended operation
 * 5. Key must not be expired
 * 6. Algorithm must be in approved policy
 * 7. Cipher must be in approved policy (if provided)
 * 8. Hash must be in approved policy (if provided)
 * 9. RSA key size must meet minimum (if applicable)
 */
export function enforcePolicy(
  policy: CryptoAlgorithmPolicy,
  keyRef: KeyRef,
  intendedAlgorithm: string,
  intendedUsage: 'ENCRYPT' | 'DECRYPT' | 'SIGN' | 'VERIFY',
  submissionEnvironment: 'TEST' | 'CERTIFICATION' | 'PRODUCTION',
  intendedCipher?: string,
  intendedHash?: string,
): void {
  // 1. State must be ACTIVE
  if (keyRef.state !== 'ACTIVE') {
    throw new SepError(ErrorCode.CRYPTO_KEY_INVALID_STATE, {
      keyReferenceId: keyRef.keyReferenceId,
      currentState: keyRef.state,
      requiredState: 'ACTIVE',
    });
  }

  // 2. Revocation check
  if (keyRef.revokedAt !== null) {
    throw new SepError(ErrorCode.CRYPTO_KEY_INVALID_STATE, {
      keyReferenceId: keyRef.keyReferenceId,
      revokedAt: keyRef.revokedAt.toISOString(),
    });
  }

  // 3. Environment segregation — no cross-environment key use
  if (keyRef.environment !== submissionEnvironment) {
    throw new SepError(ErrorCode.POLICY_ENVIRONMENT_MISMATCH, {
      keyReferenceId: keyRef.keyReferenceId,
      keyEnvironment: keyRef.environment,
      submissionEnvironment,
    });
  }

  // 4. Usage check — key must be authorised for this operation
  if (!keyRef.allowedUsages.includes(intendedUsage)) {
    throw new SepError(ErrorCode.CRYPTO_POLICY_VIOLATION, {
      keyReferenceId: keyRef.keyReferenceId,
      violatedRule: 'usage',
      intendedUsage,
      allowedUsages: keyRef.allowedUsages,
    });
  }

  // 5. Expiry check
  if (keyRef.expiresAt !== null && keyRef.expiresAt < new Date()) {
    throw new SepError(ErrorCode.CRYPTO_KEY_EXPIRED, {
      keyReferenceId: keyRef.keyReferenceId,
      expiredAt: keyRef.expiresAt.toISOString(),
    });
  }

  // 6. Forbidden algorithm check — reject before allowlist to prevent accidental weakening
  const normalizedAlgo = intendedAlgorithm.toLowerCase();
  if (policy.forbiddenAlgorithms.includes(normalizedAlgo)) {
    throw new SepError(ErrorCode.CRYPTO_UNSUPPORTED_ALGORITHM, {
      keyReferenceId: keyRef.keyReferenceId,
      violatedRule: 'forbidden_algorithm',
      provided: intendedAlgorithm,
      allowed: policy.allowedAlgorithms,
    });
  }

  // 7. Algorithm allowlist check
  if (!policy.allowedAlgorithms.includes(normalizedAlgo)) {
    throw new SepError(ErrorCode.CRYPTO_UNSUPPORTED_ALGORITHM, {
      keyReferenceId: keyRef.keyReferenceId,
      violatedRule: 'algorithm',
      provided: intendedAlgorithm,
      allowed: policy.allowedAlgorithms,
    });
  }

  // 8. Cipher check — forbidden first, then allowlist
  if (intendedCipher !== undefined) {
    const normalizedCipher = intendedCipher.toLowerCase();
    if (policy.forbiddenCiphers.includes(normalizedCipher)) {
      throw new SepError(ErrorCode.CRYPTO_POLICY_VIOLATION, {
        keyReferenceId: keyRef.keyReferenceId,
        violatedRule: 'forbidden_cipher',
        provided: intendedCipher,
        allowed: policy.allowedCiphers,
      });
    }
    if (!policy.allowedCiphers.includes(normalizedCipher)) {
      throw new SepError(ErrorCode.CRYPTO_POLICY_VIOLATION, {
        keyReferenceId: keyRef.keyReferenceId,
        violatedRule: 'cipher',
        provided: intendedCipher,
        allowed: policy.allowedCiphers,
      });
    }
  }

  // 9. Hash check — forbidden first, then allowlist
  if (intendedHash !== undefined) {
    const normalizedHash = intendedHash.toLowerCase();
    if (policy.forbiddenHashes.includes(normalizedHash)) {
      throw new SepError(ErrorCode.CRYPTO_POLICY_VIOLATION, {
        keyReferenceId: keyRef.keyReferenceId,
        violatedRule: 'forbidden_hash',
        provided: intendedHash,
        allowed: policy.allowedHashes,
      });
    }
    if (!policy.allowedHashes.includes(normalizedHash)) {
      throw new SepError(ErrorCode.CRYPTO_POLICY_VIOLATION, {
        keyReferenceId: keyRef.keyReferenceId,
        violatedRule: 'hash',
        provided: intendedHash,
        allowed: policy.allowedHashes,
      });
    }
  }

  // 10. RSA minimum key size — parsed from algorithm string e.g. rsa2048, rsa4096
  if (normalizedAlgo.startsWith('rsa')) {
    const sizeMatch = /rsa(\d+)/.exec(keyRef.algorithm.toLowerCase());
    const keySize = sizeMatch !== null ? parseInt(sizeMatch[1] ?? '0', 10) : 0;
    if (keySize > 0 && keySize < policy.minRsaKeySize) {
      throw new SepError(ErrorCode.CRYPTO_POLICY_VIOLATION, {
        keyReferenceId: keyRef.keyReferenceId,
        violatedRule: 'minRsaKeySize',
        keySize,
        minRequired: policy.minRsaKeySize,
      });
    }
  }
}
