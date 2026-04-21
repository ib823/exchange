/**
 * MFA recovery code verification (M3.A4-T04b).
 *
 * Exchanges an MFA challenge token + one recovery code for an access
 * token + refresh token. Used when a user has lost their TOTP device
 * but still holds the one-time recovery codes issued during MFA
 * enrollment.
 *
 * Flow:
 *   1. Verify the challenge JWT (HS256, typ == 'mfa_challenge').
 *   2. Atomically consume the challengeId via MfaChallengeStore —
 *      first call wins; replays fail with AUTH_MFA_CHALLENGE_CONSUMED.
 *      Same single-use contract as the TOTP verify path so a captured
 *      challenge token is burned on the first presentation regardless
 *      of which endpoint the attacker hits.
 *   3. Load the user's unconsumed RecoveryCode rows (argon2id-hashed).
 *   4. Walk the codes with argon2Verify until match or exhaustion.
 *   5a. Match: mark that one code consumed, reset the per-user
 *       failure counter, issue access + refresh.
 *   5b. No match: increment the per-user failure counter, apply the
 *       1s/5s/lockout delay schedule, throw AUTH_RECOVERY_CODE_INVALID
 *       or AUTH_ACCOUNT_LOCKED.
 *
 * Brute-force mitigation — 1s / 5s / lockout after third:
 *   Recovery codes are 40-bit base32 values. Three random guesses
 *   have ~3e-13 probability of hitting a given 8-char code — so the
 *   3-strike lockout, not the delay, is the real protection. The
 *   delays discourage casual serial guessing and keep the interactive
 *   attack window obvious in ops logs.
 *
 *   Counter storage: Redis `sep:mfa-recovery-failures:<userId>` with
 *   30-minute TTL, same sliding-window shape as the password lockout.
 *   Counter is per-user (not per-challenge) so an attacker who re-
 *   logs-in to refresh the challenge still ratchets the counter.
 *
 *   Threshold 3 (not 10 like password): recovery codes are
 *   higher-value than a password guess — a successful recovery code
 *   skips MFA entirely. Tighter budget is warranted.
 *
 * Why a separate endpoint rather than overloading /auth/mfa/verify:
 *   The challenge-burn-on-wrong-code property is the same, but the
 *   verification primitives differ (otplib vs argon2id) and the
 *   brute-force budgets differ (TOTP is only rate-limited by the
 *   30-second window; recovery is hard-limited at 3). Keeping the
 *   endpoints separate keeps those policies explicit and
 *   auditable.
 */

import { Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { verify as argon2Verify } from '@node-rs/argon2';
import Redis from 'ioredis';
import { DatabaseService } from '@sep/db';
import { SepError, ErrorCode, getConfig } from '@sep/common';
import { createLogger } from '@sep/observability';
import { AuthService, type AuthTokens, type TokenPayload } from './auth.service';
import { MfaChallengeStore, REDIS_CLIENT } from './mfa-challenge-store.service';
import { RefreshTokenService, type IssuedRefreshToken } from './refresh-token.service';

const logger = createLogger({ service: 'control-plane', module: 'mfa-recover' });

const FAILURE_KEY_PREFIX = 'sep:mfa-recovery-failures:';
const FAILURE_WINDOW_SECONDS = 30 * 60;
const LOCKOUT_DURATION_MINUTES = 30;
const LOCKOUT_THRESHOLD = 3;
const DELAY_MS_FIRST_FAILURE = 1_000;
const DELAY_MS_SECOND_FAILURE = 5_000;

interface MfaChallengeJwtPayload {
  readonly typ: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly challengeId: string;
}

@Injectable()
export class MfaRecoverService {
  constructor(
    private readonly database: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
    private readonly challengeStore: MfaChallengeStore,
    private readonly refreshTokenService: RefreshTokenService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async recover(
    challengeToken: string,
    recoveryCode: string,
  ): Promise<AuthTokens & { readonly refreshToken: IssuedRefreshToken }> {
    const cfg = getConfig();
    let payload: MfaChallengeJwtPayload;
    try {
      payload = this.jwtService.verify<MfaChallengeJwtPayload>(challengeToken, {
        secret: cfg.auth.jwtSecret,
        issuer: cfg.auth.jwtIssuer,
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException(
        new SepError(
          ErrorCode.AUTH_MFA_CHALLENGE_INVALID,
          {},
          'MFA challenge token is invalid or expired',
        ).toClientJson(),
      );
    }

    if (payload.typ !== 'mfa_challenge') {
      throw new UnauthorizedException(
        new SepError(
          ErrorCode.AUTH_MFA_CHALLENGE_INVALID,
          { reason: 'Wrong typ claim on challenge token' },
          'MFA challenge token is invalid or expired',
        ).toClientJson(),
      );
    }

    // Challenge single-use: same semantics as TOTP verify. Burns
    // before we do argon2 work so a bad recovery code still consumes
    // the challenge.
    const consumeResult = await this.challengeStore.consume(payload.challengeId);
    if (!consumeResult.consumed) {
      throw new UnauthorizedException(
        new SepError(
          ErrorCode.AUTH_MFA_CHALLENGE_CONSUMED,
          { reason: consumeResult.reason },
          'MFA challenge has already been used — restart login',
        ).toClientJson(),
      );
    }

    // Per-user failure counter gate: if the user is already past the
    // threshold from recent failures, short-circuit to locked. The
    // lockedUntil field is the source of truth — we consult it via
    // the user row below.
    return this.database.forTenant(payload.tenantId, async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: payload.userId },
        select: {
          id: true,
          tenantId: true,
          email: true,
          mfaEnrolledAt: true,
          lockedUntil: true,
          roleAssignments: { select: { role: true }, take: 1 },
          recoveryCodes: {
            where: { usedAt: null },
            select: { id: true, codeHash: true },
          },
        },
      });

      if (user?.mfaEnrolledAt === null || user?.mfaEnrolledAt === undefined) {
        throw new UnauthorizedException(
          new SepError(
            ErrorCode.AUTH_MFA_CHALLENGE_INVALID,
            { reason: 'User MFA state changed since challenge was issued' },
            'MFA challenge token is invalid or expired',
          ).toClientJson(),
        );
      }

      if (user.lockedUntil !== null && user.lockedUntil > new Date()) {
        throw new UnauthorizedException(
          new SepError(
            ErrorCode.AUTH_ACCOUNT_LOCKED,
            { lockedUntil: user.lockedUntil.toISOString() },
            `Account is temporarily locked until ${user.lockedUntil.toISOString()}`,
          ).toClientJson(),
        );
      }

      // Walk unconsumed codes. argon2Verify is slow by design; a
      // user typically has <=10 recovery codes so worst case is ~1s
      // of CPU per presentation.
      let matchedId: string | null = null;
      for (const row of user.recoveryCodes) {
        // eslint-disable-next-line no-await-in-loop -- sequential argon2 is intentional
        const ok = await argon2Verify(row.codeHash, recoveryCode);
        if (ok) {
          matchedId = row.id;
          break;
        }
      }

      if (matchedId === null) {
        await this.onRecoveryFailure(user.id, tx);
        throw new UnauthorizedException(
          new SepError(
            ErrorCode.AUTH_RECOVERY_CODE_INVALID,
            {},
            'Recovery code invalid',
          ).toClientJson(),
        );
      }

      // Success path: consume the matched code, reset failure counter,
      // mint access + refresh tokens.
      await tx.recoveryCode.update({
        where: { id: matchedId },
        data: { usedAt: new Date() },
      });
      await tx.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
      });
      await this.resetFailureCounter(user.id);

      const role = user.roleAssignments[0]?.role ?? 'TENANT_ADMIN';
      const tokenPayload: TokenPayload = {
        userId: user.id,
        tenantId: user.tenantId,
        role,
        email: user.email,
      };
      const accessTokens = this.authService.issueToken(tokenPayload);
      const refreshToken = await this.refreshTokenService.issue(tx, user.tenantId, user.id);
      logger.info(
        { userId: user.id, tenantId: user.tenantId },
        'MFA recovery code consumed, access + refresh tokens issued',
      );
      return { ...accessTokens, refreshToken };
    });
  }

  /**
   * Apply the 1s / 5s / lockout schedule after a wrong recovery code.
   * Counter lives in Redis with a sliding window; the lockout itself
   * is persisted on the user row so it survives process restart and
   * is visible to other auth paths (password login, TOTP verify).
   */
  private async onRecoveryFailure(
    userId: string,
    tx: Parameters<Parameters<DatabaseService['forTenant']>[1]>[0],
  ): Promise<void> {
    const key = `${FAILURE_KEY_PREFIX}${userId}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      // First failure → set TTL so the counter resets if the user
      // doesn't re-offend in 30 min.
      await this.redis.expire(key, FAILURE_WINDOW_SECONDS);
    }

    if (count >= LOCKOUT_THRESHOLD) {
      const lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60_000);
      await tx.user.update({
        where: { id: userId },
        data: { lockedUntil },
      });
      // Reset the counter so the next window starts fresh after
      // the lock expires.
      await this.redis.del(key);
      logger.warn(
        { userId, lockedUntil: lockedUntil.toISOString() },
        'Recovery-code brute-force lockout triggered',
      );
      throw new UnauthorizedException(
        new SepError(
          ErrorCode.AUTH_ACCOUNT_LOCKED,
          { lockedUntil: lockedUntil.toISOString() },
          `Account is temporarily locked until ${lockedUntil.toISOString()}`,
        ).toClientJson(),
      );
    }

    const delayMs = this.delayForCount(count);
    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  private delayForCount(count: number): number {
    if (count === 1) {
      return DELAY_MS_FIRST_FAILURE;
    }
    if (count === 2) {
      return DELAY_MS_SECOND_FAILURE;
    }
    return 0;
  }

  private async resetFailureCounter(userId: string): Promise<void> {
    await this.redis.del(`${FAILURE_KEY_PREFIX}${userId}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
