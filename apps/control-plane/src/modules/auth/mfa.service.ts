/**
 * MFA enrollment + activation (M3.A4-T02).
 *
 * Two-phase flow so a user can't lock themselves out by generating
 * a secret and then losing the provisioning QR before confirming:
 *
 *   1. enroll(userId, email): generate TOTP secret, store in Vault,
 *      persist `User.mfaSecretRef`, emit provisioning URI + QR data
 *      URL. `User.mfaEnrolledAt` is NOT set yet — MFA is not
 *      required for login at this point.
 *
 *   2. activate(userId, totpCode): verify the user can produce a
 *      valid TOTP code against the stored secret. On success:
 *      - set `User.mfaEnrolledAt = now()` — MFA is now required
 *      - generate 10 recovery codes, argon2id-hash each, insert
 *        into `recovery_codes` — return the raw codes ONCE so the
 *        user can copy them down
 *
 * Re-enrollment (user lost their device and wants a new secret)
 * requires explicit MFA reset — not in M3.A4 scope. Deferred.
 *
 * TOTP window: otplib's `authenticator.options.window = 1` accepts
 * the current 30-second window plus ±1 neighbour (90-second
 * acceptance total). Compensates for normal device/server clock
 * skew. Tighter would fail users whose devices drift by 30s;
 * wider would weaken the one-time-use property.
 *
 * Recovery codes: 10 codes × 8 chars base32 = user-memorable
 * strings like "JBSWY3DP". Hashed with argon2id because they're
 * low-entropy (~40 bits each vs 256 bits for refresh tokens);
 * slow hashing defends against offline brute-force of a stolen
 * recovery_codes table. Verification walks the hashed set and
 * argon2Verify's each — ~1s worst case, acceptable for a
 * rarely-exercised path.
 */

import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { generateSecret, generateURI, verify as otpVerify } from 'otplib';
import { toDataURL as qrToDataUrl } from 'qrcode';
import { hash as argon2Hash } from '@node-rs/argon2';
import { DatabaseService } from '@sep/db';
import { SepError, ErrorCode, getConfig } from '@sep/common';
import { createLogger } from '@sep/observability';
import { MfaSecretVaultService } from './mfa-secret-vault.service';

const logger = createLogger({ service: 'control-plane', module: 'mfa' });

const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_BYTES = 5; // → 8 base32 chars
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * TOTP acceptance window. Default TOTP step is 30 s; setting
 * epochTolerance = 30 accepts the current window ±1 neighbour
 * (90 s total acceptance). Compensates for normal device/server
 * clock skew without weakening one-time semantics unduly.
 */
const TOTP_EPOCH_TOLERANCE_SECONDS = 30;

export interface MfaEnrollResult {
  readonly provisioningUri: string;
  readonly qrDataUrl: string;
}

export interface MfaActivateResult {
  readonly recoveryCodes: readonly string[];
}

@Injectable()
export class MfaService {
  constructor(
    private readonly database: DatabaseService,
    private readonly mfaVault: MfaSecretVaultService,
  ) {}

  /**
   * Phase 1: generate + store a TOTP secret, return provisioning
   * material. Idempotent-refuse: if the user already has a secret,
   * refuse until the user explicitly resets MFA (out of scope for
   * M3.A4).
   */
  async enroll(userId: string, tenantId: string, email: string): Promise<MfaEnrollResult> {
    return this.database.forTenant(tenantId, async (db) => {
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { id: true, mfaSecretRef: true, mfaEnrolledAt: true },
      });
      if (user === null) {
        throw new SepError(ErrorCode.RBAC_RESOURCE_NOT_FOUND, {
          resourceType: 'User',
          objectId: userId,
        });
      }
      if (user.mfaSecretRef !== null && user.mfaEnrolledAt !== null) {
        throw new ConflictException(
          new SepError(
            ErrorCode.CRYPTO_KEY_INVALID_STATE,
            { reason: 'MFA already activated for this user' },
            'MFA already activated for this user',
          ).toClientJson(),
        );
      }

      const secret = generateSecret();
      const secretRef = await this.mfaVault.storeSecret(userId, secret);

      await db.user.update({
        where: { id: userId },
        data: { mfaSecretRef: secretRef },
      });

      const issuer = getConfig().auth.jwtIssuer;
      const provisioningUri = generateURI({ issuer, label: email, secret });
      const qrDataUrl = await qrToDataUrl(provisioningUri);

      logger.info({ userId, tenantId }, 'MFA enrollment started');
      return { provisioningUri, qrDataUrl };
    });
  }

  /**
   * Phase 2: confirm the user can produce a valid TOTP code. On
   * success, activate MFA and issue 10 recovery codes.
   */
  async activate(
    userId: string,
    tenantId: string,
    totpCode: string,
  ): Promise<MfaActivateResult> {
    return this.database.forTenant(tenantId, async (db) => {
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { id: true, mfaSecretRef: true, mfaEnrolledAt: true },
      });
      if (user?.mfaSecretRef === null || user?.mfaSecretRef === undefined) {
        throw new BadRequestException(
          new SepError(
            ErrorCode.CRYPTO_KEY_INVALID_STATE,
            { reason: 'MFA enrollment has not been started for this user' },
            'MFA enrollment has not been started for this user',
          ).toClientJson(),
        );
      }
      if (user.mfaEnrolledAt !== null) {
        throw new ConflictException(
          new SepError(
            ErrorCode.CRYPTO_KEY_INVALID_STATE,
            { reason: 'MFA already activated for this user' },
            'MFA already activated for this user',
          ).toClientJson(),
        );
      }

      const secret = await this.mfaVault.retrieveSecret(user.mfaSecretRef);
      const verifyResult = await otpVerify({
        secret,
        token: totpCode,
        epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS,
      });
      if (!verifyResult.valid) {
        // Not incrementing lockout counters here — activation is a
        // logged-in-user operation, not a password-login probe. An
        // attacker with a valid JWT already has account access;
        // brute-forcing TOTP activation doesn't escalate.
        throw new BadRequestException(
          new SepError(
            ErrorCode.AUTH_TOKEN_INVALID,
            { reason: 'TOTP code did not verify against the enrolled secret' },
            'TOTP code did not verify against the enrolled secret',
          ).toClientJson(),
        );
      }

      const rawCodes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
      const hashedRows = await Promise.all(
        rawCodes.map(async (code) => ({
          tenantId,
          userId,
          codeHash: await argon2Hash(code),
        })),
      );

      await db.user.update({
        where: { id: userId },
        data: { mfaEnrolledAt: new Date() },
      });
      await db.recoveryCode.createMany({ data: hashedRows });

      logger.info(
        { userId, tenantId, recoveryCodeCount: rawCodes.length },
        'MFA activated, recovery codes issued',
      );
      return { recoveryCodes: rawCodes };
    });
  }
}

// ─── Internals ───────────────────────────────────────────────────

function generateRecoveryCodes(count: number): readonly string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    codes.push(generateRecoveryCode());
  }
  return codes;
}

function generateRecoveryCode(): string {
  const bytes = randomBytes(RECOVERY_CODE_BYTES);
  let out = '';
  // Simple base32 encode: 5 bytes → 8 chars. Bit-packing done by hand
  // to avoid a dep on `base32-encode` for a ~20-line helper.
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i];
    if (byte === undefined) {
      continue;
    }
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[(buffer >> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(buffer << (5 - bits)) & 0x1f];
  }
  return out;
}
