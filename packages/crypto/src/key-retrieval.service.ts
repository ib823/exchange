/**
 * Key retrieval service — resolves and validates KeyReference records
 * for crypto operations.
 *
 * This is the single path through which processors access key material
 * for validation. Direct Vault/KMS calls are forbidden outside
 * KeyCustodyAbstraction and this service.
 *
 * Validation order:
 * 1. State is ACTIVE — reject all other states with specific error codes
 * 2. Environment matches runtime environment
 * 3. Expiry has not passed
 * 4. Armored public key loaded from the backend (which itself verifies
 *    stored-fingerprint vs. ref-fingerprint as the first line of defence)
 * 5. Defence-in-depth check: extract the fingerprint directly from the
 *    armored key and compare to row.fingerprint — catches tampering
 *    where the stored-fingerprint was forged alongside a substituted
 *    armored key
 * 6. Algorithm extracted from the armored key matches row.algorithm
 */

import * as openpgp from 'openpgp';
import { SepError, ErrorCode } from '@sep/common';
import { createLogger } from '@sep/observability';
import type { KeyRef } from './interfaces';
import type { KeyCustodyAbstraction } from './custody/key-custody-abstraction';
import type { KeyReferenceInput, KeyUsage } from './custody/i-key-custody-backend';
import type { KeyBackendType } from './custody/key-reference-input';

const logger = createLogger({ service: 'crypto', module: 'key-retrieval' });

export interface KeyReferenceRow {
  readonly id: string;
  readonly tenantId: string;
  readonly partnerProfileId: string | null;
  readonly name: string;
  readonly usage: string[];
  readonly backendType: string;
  readonly backendRef: string;
  readonly fingerprint: string;
  readonly algorithm: string;
  readonly version: number;
  readonly state: string;
  readonly environment: string;
  readonly activatedAt: Date | null;
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
}

export interface ResolvedKey {
  readonly keyRef: KeyRef;
  readonly armoredKey: string;
  /** The actual cryptographic fingerprint extracted from the key material */
  readonly fingerprint: string;
}

export class KeyRetrievalService {
  constructor(private readonly keyCustody: KeyCustodyAbstraction) {}

  async resolveKey(
    row: KeyReferenceRow,
    runtimeEnvironment: 'TEST' | 'CERTIFICATION' | 'PRODUCTION',
  ): Promise<ResolvedKey> {
    this.validateState(row);

    if (row.environment !== runtimeEnvironment) {
      throw new SepError(ErrorCode.POLICY_ENVIRONMENT_MISMATCH, {
        keyReferenceId: row.id,
        keyEnvironment: row.environment,
        submissionEnvironment: runtimeEnvironment,
      });
    }

    if (row.expiresAt !== null && row.expiresAt < new Date()) {
      throw new SepError(ErrorCode.CRYPTO_KEY_EXPIRED, {
        keyReferenceId: row.id,
        expiredAt: row.expiresAt.toISOString(),
      });
    }

    const refInput: KeyReferenceInput = {
      id: row.id,
      tenantId: row.tenantId,
      backendType: row.backendType as KeyBackendType,
      backendRef: row.backendRef,
      algorithm: row.algorithm,
      fingerprint: row.fingerprint,
      usage: row.usage as readonly KeyUsage[],
    };

    let armoredKey: string;
    try {
      const backend = this.keyCustody.backendFor(refInput);
      armoredKey = await backend.getPublicKey(refInput);
    } catch (err) {
      if (err instanceof SepError) {
        throw err;
      }
      logger.error(
        { keyReferenceId: row.id, backendType: row.backendType },
        'Key material backend unavailable',
      );
      throw new SepError(ErrorCode.KEY_BACKEND_UNAVAILABLE, {
        keyReferenceId: row.id,
      });
    }

    // Defence-in-depth: parse the armored key and verify fingerprint +
    // algorithm against the DB row. The backend already checked the
    // stored fingerprint; this catches the case where an attacker
    // substitutes both the armored key AND its stored fingerprint in
    // Vault, which passes the backend check but not this one.
    let parsed: openpgp.Key;
    let actualFingerprint: string;
    let actualAlgorithm: string;
    let bitLength = 0;
    try {
      parsed = await openpgp.readKey({ armoredKey });
      actualFingerprint = parsed.getFingerprint();
      const algInfo = parsed.getAlgorithmInfo();
      actualAlgorithm = mapAlgorithm(algInfo.algorithm);
      bitLength = 'bits' in algInfo ? Number(algInfo.bits) : 0;
    } catch (err) {
      if (err instanceof SepError) {
        throw err;
      }
      logger.error({ keyReferenceId: row.id }, 'Failed to parse armored key returned by backend');
      throw new SepError(ErrorCode.KEY_BACKEND_UNAVAILABLE, {
        keyReferenceId: row.id,
        reason: 'Backend returned material that could not be parsed as an OpenPGP key',
      });
    }

    if (actualFingerprint.toLowerCase() !== row.fingerprint.toLowerCase()) {
      logger.error(
        {
          keyReferenceId: row.id,
          expectedFingerprint: row.fingerprint.substring(0, 8) + '...',
          actualFingerprint: actualFingerprint.substring(0, 8) + '...',
        },
        'Key fingerprint mismatch — possible key substitution',
      );
      throw new SepError(ErrorCode.KEY_FINGERPRINT_MISMATCH, {
        keyReferenceId: row.id,
      });
    }

    if (actualAlgorithm.toLowerCase() !== row.algorithm.toLowerCase()) {
      logger.warn(
        { keyReferenceId: row.id, expected: row.algorithm, actual: actualAlgorithm },
        'Key algorithm mismatch',
      );
      throw new SepError(ErrorCode.KEY_FINGERPRINT_MISMATCH, {
        keyReferenceId: row.id,
      });
    }

    logger.debug(
      {
        keyReferenceId: row.id,
        fingerprint: actualFingerprint.substring(0, 8) + '...',
        algorithm: actualAlgorithm,
        bitLength,
      },
      'Key fingerprint verified',
    );

    const keyRef: KeyRef = {
      keyReferenceId: row.id,
      tenantId: row.tenantId,
      backendType: row.backendType as KeyRef['backendType'],
      backendRef: row.backendRef,
      algorithm: row.algorithm,
      fingerprint: row.fingerprint,
      state: row.state as KeyRef['state'],
      allowedUsages: row.usage as KeyRef['allowedUsages'],
      revokedAt: row.revokedAt,
      expiresAt: row.expiresAt,
      environment: row.environment,
    };

    return { keyRef, armoredKey, fingerprint: actualFingerprint };
  }

  private validateState(row: KeyReferenceRow): void {
    switch (row.state) {
      case 'ACTIVE':
        return; // Only valid state for crypto operations
      case 'EXPIRED':
        throw new SepError(ErrorCode.CRYPTO_KEY_EXPIRED, {
          keyReferenceId: row.id,
          expiredAt: row.expiresAt !== null ? row.expiresAt.toISOString() : 'unknown',
        });
      case 'SUSPENDED':
      case 'COMPROMISED':
      case 'REVOKED':
      case 'RETIRED':
      case 'DESTROYED':
      case 'DRAFT':
      case 'IMPORTED':
      case 'VALIDATED':
      case 'ROTATING':
        throw new SepError(ErrorCode.CRYPTO_KEY_INVALID_STATE, {
          keyReferenceId: row.id,
          currentState: row.state,
          requiredState: 'ACTIVE',
        });
      default: {
        const _exhaustive: never = row.state as never;
        throw new SepError(ErrorCode.CRYPTO_KEY_INVALID_STATE, {
          keyReferenceId: row.id,
          currentState: String(_exhaustive),
          requiredState: 'ACTIVE',
        });
      }
    }
  }
}

function mapAlgorithm(openpgpAlgorithm: string): string {
  const alg = openpgpAlgorithm.toLowerCase();
  if (alg.startsWith('rsa')) {
    return 'rsa';
  }
  if (alg === 'ecdh') {
    return 'ecdh';
  }
  if (alg === 'ecdsa') {
    return 'ecdsa';
  }
  if (alg === 'eddsa' || alg === 'eddsalegacy') {
    return 'eddsa';
  }
  return alg;
}
