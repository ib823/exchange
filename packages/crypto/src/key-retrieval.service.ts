/**
 * Key retrieval service — resolves and validates KeyReference records for crypto operations.
 *
 * This is the ONLY path through which M2 processors access key material.
 * Direct Vault/KMS calls are forbidden outside this service.
 *
 * Validation order:
 * 1. KeyReference exists in DB for (tenantId, keyReferenceId)
 * 2. State is ACTIVE — reject all other states with specific error codes
 * 3. Environment matches runtime environment
 * 4. Key material loaded from backend
 * 5. Fingerprint, algorithm verified against KeyReference row
 */

import { SepError, ErrorCode } from '@sep/common';
import { createLogger } from '@sep/observability';
import type { KeyRef } from './interfaces';
import type { IKeyMaterialProvider, KeyMaterial } from './key-material-provider';

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
  constructor(private readonly keyMaterialProvider: IKeyMaterialProvider) {}

  async resolveKey(
    row: KeyReferenceRow,
    runtimeEnvironment: 'TEST' | 'CERTIFICATION' | 'PRODUCTION',
  ): Promise<ResolvedKey> {
    // 1. Validate state — only ACTIVE permits crypto operations
    this.validateState(row);

    // 2. Validate environment
    if (row.environment !== runtimeEnvironment) {
      throw new SepError(ErrorCode.POLICY_ENVIRONMENT_MISMATCH, {
        keyReferenceId: row.id,
        keyEnvironment: row.environment,
        submissionEnvironment: runtimeEnvironment,
      });
    }

    // 3. Check expiry
    if (row.expiresAt !== null && row.expiresAt < new Date()) {
      throw new SepError(ErrorCode.CRYPTO_KEY_EXPIRED, {
        keyReferenceId: row.id,
        expiredAt: row.expiresAt.toISOString(),
      });
    }

    // 4. Load key material from backend
    let material: KeyMaterial;
    try {
      material = await this.keyMaterialProvider.loadKeyMaterial(row.backendRef);
    } catch (err) {
      if (err instanceof SepError) {throw err;}
      logger.error(
        { keyReferenceId: row.id, backendType: row.backendType },
        'Key material backend unavailable',
      );
      throw new SepError(ErrorCode.KEY_BACKEND_UNAVAILABLE, {
        keyReferenceId: row.id,
      });
    }

    // 5. Verify fingerprint matches DB record
    if (material.fingerprint.toLowerCase() !== row.fingerprint.toLowerCase()) {
      logger.error(
        {
          keyReferenceId: row.id,
          expectedFingerprint: row.fingerprint.substring(0, 8) + '...',
          actualFingerprint: material.fingerprint.substring(0, 8) + '...',
        },
        'Key fingerprint mismatch — possible key substitution',
      );
      throw new SepError(ErrorCode.KEY_FINGERPRINT_MISMATCH, {
        keyReferenceId: row.id,
      });
    }

    // 6. Verify algorithm matches
    if (material.algorithm.toLowerCase() !== row.algorithm.toLowerCase()) {
      logger.warn(
        { keyReferenceId: row.id, expected: row.algorithm, actual: material.algorithm },
        'Key algorithm mismatch',
      );
      throw new SepError(ErrorCode.KEY_FINGERPRINT_MISMATCH, {
        keyReferenceId: row.id,
      });
    }

    logger.debug(
      {
        keyReferenceId: row.id,
        fingerprint: material.fingerprint.substring(0, 8) + '...',
        algorithm: material.algorithm,
        bitLength: material.bitLength,
      },
      'Key fingerprint verified',
    );

    const keyRef: KeyRef = {
      keyReferenceId: row.id,
      backendRef: row.backendRef,
      algorithm: row.algorithm,
      state: row.state as KeyRef['state'],
      allowedUsages: row.usage as KeyRef['allowedUsages'],
      revokedAt: row.revokedAt,
      expiresAt: row.expiresAt,
      environment: row.environment,
    };

    return { keyRef, armoredKey: material.armoredKey, fingerprint: material.fingerprint };
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
