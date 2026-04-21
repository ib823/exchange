/**
 * MFA secret vault service (M3.A4-T02a).
 *
 * Stores TOTP shared secrets in HashiCorp Vault KV v2 under the
 * `platform/mfa-secrets/<userId>` path convention (sibling of the
 * `platform/keys/*` path used by PlatformVaultBackend in ADR-0007).
 *
 * Why a dedicated service instead of PlatformVaultBackend:
 *
 *   - PlatformVaultBackend stores StoredKeyMaterial (armoredPublicKey,
 *     armoredPrivateKey, fingerprint, algorithm) — an OpenPGP-shaped
 *     payload. TOTP secrets are a fundamentally different data shape
 *     (base32-encoded raw bytes, ~20 bytes). Coercing them through
 *     the PGP backend would be a lie at the type boundary.
 *   - TOTP secrets don't participate in the IKeyCustodyBackend
 *     contract (no rotate, no revoke semantics, no composite ops).
 *   - A dedicated service keeps the MFA flow's Vault coupling
 *     localised — reviewers see exactly one file that mediates
 *     between the auth module and Vault.
 *
 * Boundary discipline (same principles as the PGP backends):
 *
 *   - The secret NEVER leaves this service as a return value after
 *     storage; enrollment generates → stores → emits provisioning URI
 *     in one call. Verification retrieves the secret, passes it to
 *     otplib, and never returns it to callers.
 *   - Logs never carry the secret. Log only userId and the derived
 *     KV path.
 *   - Errors wrap Vault failures in a typed SepError — no raw HTTP
 *     bodies or tokens leak into context.
 */

import { Injectable, Inject } from '@nestjs/common';
import { SepError, ErrorCode } from '@sep/common';
import { createLogger } from '@sep/observability';
import { VaultClient } from '@sep/crypto';
import { VAULT_CLIENT } from '../crypto-custody/crypto-custody.module';

const logger = createLogger({ service: 'control-plane', module: 'mfa-secret-vault' });

const MFA_KV_MOUNT = 'kv';
const MFA_PATH_PREFIX = 'platform/mfa-secrets';

interface StoredMfaSecret {
  /** base32-encoded TOTP shared secret (~32 chars for 160-bit secret) */
  readonly secret: string;
  /** ISO timestamp when the secret was stored (for audit correlation) */
  readonly storedAt: string;
}

@Injectable()
export class MfaSecretVaultService {
  constructor(@Inject(VAULT_CLIENT) private readonly vault: VaultClient) {}

  /**
   * Path for a given userId. Exposed so callers can persist the
   * path as `User.mfaSecretRef` without reconstructing it.
   */
  pathFor(userId: string): string {
    if (userId.length === 0) {
      throw new SepError(ErrorCode.TENANT_CONTEXT_INVALID, {
        reason: 'MFA secret path requires a non-empty userId',
      });
    }
    return `${MFA_PATH_PREFIX}/${userId}`;
  }

  /**
   * Persist a freshly-generated TOTP secret. Returns the KV path for
   * the caller to store on `User.mfaSecretRef`. The secret itself
   * does not cross this return boundary.
   */
  async storeSecret(userId: string, secret: string): Promise<string> {
    const path = this.pathFor(userId);
    const payload: StoredMfaSecret = {
      secret,
      storedAt: new Date().toISOString(),
    };
    try {
      await this.vault.kvWrite<StoredMfaSecret>(MFA_KV_MOUNT, path, payload);
      logger.info({ userId, path }, 'MFA secret stored in Vault');
      return path;
    } catch (err) {
      if (err instanceof SepError) {
        throw err;
      }
      logger.error({ userId, path }, 'Failed to store MFA secret');
      throw new SepError(ErrorCode.KEY_BACKEND_UNAVAILABLE, {
        operation: 'storeMfaSecret',
        reason: 'Vault kvWrite failed for MFA secret path',
      });
    }
  }

  /**
   * Retrieve a previously stored secret. `secretRef` is the KV path
   * stored on `User.mfaSecretRef` — same vocabulary as the backend
   * contract's `backendRef`.
   *
   * The secret is returned only long enough for the caller to pass
   * it to otplib's verification routine; callers MUST NOT persist
   * or log the return value.
   */
  async retrieveSecret(secretRef: string): Promise<string> {
    if (secretRef.length === 0 || !secretRef.startsWith(`${MFA_PATH_PREFIX}/`)) {
      throw new SepError(ErrorCode.KEY_FINGERPRINT_MISMATCH, {
        reason: 'MFA secret ref does not match the platform/mfa-secrets/ prefix',
      });
    }
    try {
      const stored = await this.vault.kvRead<StoredMfaSecret>(MFA_KV_MOUNT, secretRef);
      return stored.secret;
    } catch (err) {
      if (err instanceof SepError) {
        throw err;
      }
      logger.error({ path: secretRef }, 'Failed to retrieve MFA secret');
      throw new SepError(ErrorCode.KEY_BACKEND_UNAVAILABLE, {
        operation: 'retrieveMfaSecret',
        reason: 'Vault kvRead failed for MFA secret path',
      });
    }
  }

  /**
   * Destroy a stored secret across all KV v2 versions (idempotent).
   * Called when a user resets MFA — the secret is gone from Vault
   * before the User.mfaSecretRef column is cleared.
   */
  async destroySecret(secretRef: string): Promise<void> {
    if (secretRef.length === 0 || !secretRef.startsWith(`${MFA_PATH_PREFIX}/`)) {
      throw new SepError(ErrorCode.KEY_FINGERPRINT_MISMATCH, {
        reason: 'MFA secret ref does not match the platform/mfa-secrets/ prefix',
      });
    }
    try {
      await this.vault.kvDestroyAllVersions(MFA_KV_MOUNT, secretRef);
      logger.info({ path: secretRef }, 'MFA secret destroyed in Vault');
    } catch (err) {
      if (err instanceof SepError) {
        throw err;
      }
      logger.error({ path: secretRef }, 'Failed to destroy MFA secret');
      throw new SepError(ErrorCode.KEY_BACKEND_UNAVAILABLE, {
        operation: 'destroyMfaSecret',
        reason: 'Vault kvDestroyAllVersions failed for MFA secret path',
      });
    }
  }
}
