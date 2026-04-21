/**
 * Password login with 10/30/30 lockout (M3.A4-T03).
 *
 * Threshold policy (D-M3-6):
 *   - 10 wrong-password attempts within a 30-minute window → account
 *     locked for 30 minutes.
 *   - A wrong-password attempt more than 30 minutes after the last
 *     failure restarts the counter at 1 (sliding window).
 *   - Successful login clears both the counter and lockedUntil.
 *
 * Atomicity — core security property:
 *   The counter/lock update runs in ONE SQL UPDATE statement with
 *   CASE expressions deriving the new values from the pre-image of
 *   failedLoginAttempts + lastFailedAt. No read-check-write decomp.
 *   Parallel wrong-password requests against the same row all land
 *   on the same transaction; Postgres serialises row-level locks
 *   under UPDATE, so the 10th concurrent attempt sees the counter
 *   at 9 and transitions to 10 atomically — never two parallel
 *   "counter was 9, set to 10" races that both issue a token.
 *
 * Error discipline:
 *   - Wrong email AND wrong password both return AUTH_INVALID_CREDENTIALS
 *     with the SAME message shape. Don't leak whether the email exists.
 *   - Account lockout returns a distinct AUTH_ACCOUNT_LOCKED — the user
 *     needs to know to wait rather than keep guessing.
 *   - A user with passwordHash === null (never set a password) returns
 *     AUTH_INVALID_CREDENTIALS — indistinguishable from wrong password.
 *     Prevents enumeration of "users who never finished setup."
 *
 * MFA branching:
 *   - Password verified AND mfaEnrolledAt != null → issue an MFA
 *     challenge token (JWT with typ: 'mfa_challenge', 5-min expiry,
 *     challengeId for single-use enforcement via Redis in T04).
 *     No access token is issued on this path — the caller must
 *     complete /auth/mfa/verify.
 *   - Password verified AND mfaEnrolledAt === null → issue access +
 *     refresh tokens directly.
 *
 * RLS interaction:
 *   The UPDATE runs inside forTenant(tenantId, ...) so the Postgres
 *   `app.current_tenant_id` setting is in scope. The users RLS policy
 *   filters on `tenantId = current_setting(...)` — an UPDATE against
 *   a user in a different tenant would affect 0 rows, which we catch
 *   via the post-UPDATE row count check.
 */

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { verify as argon2Verify } from '@node-rs/argon2';
import { DatabaseService, type Prisma } from '@sep/db';
import { SepError, ErrorCode, getConfig } from '@sep/common';
import { createLogger } from '@sep/observability';
import { AuthService, type AuthTokens, type TokenPayload } from './auth.service';

const logger = createLogger({ service: 'control-plane', module: 'login' });

const LOCKOUT_THRESHOLD = 10;
const LOCKOUT_WINDOW_MINUTES = 30;
const LOCKOUT_DURATION_MINUTES = 30;
const MFA_CHALLENGE_EXPIRY = '5m';

export interface MfaChallengeToken {
  readonly mfaChallengeToken: string;
  readonly expiresIn: string;
}

export type LoginResult = AuthTokens | MfaChallengeToken;

export function isMfaChallenge(result: LoginResult): result is MfaChallengeToken {
  return 'mfaChallengeToken' in result;
}

interface LockoutUpdateRow {
  failedLoginAttempts: number;
  lockedUntil: Date | null;
}

@Injectable()
export class LoginService {
  constructor(
    private readonly database: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
  ) {}

  async validatePassword(tenantId: string, email: string, password: string): Promise<LoginResult> {
    return this.database.forTenant(tenantId, async (tx) => {
      const user = await tx.user.findUnique({
        where: { tenantId_email: { tenantId, email } },
        select: {
          id: true,
          tenantId: true,
          email: true,
          status: true,
          passwordHash: true,
          mfaEnrolledAt: true,
          lockedUntil: true,
          roleAssignments: { select: { role: true }, take: 1 },
        },
      });

      // User not found OR has no password hash: indistinguishable
      // response to the caller. Lockout counter NOT incremented —
      // nothing to key it on without a user row.
      if (user?.passwordHash === null || user?.passwordHash === undefined) {
        logger.info({ tenantId }, 'Login failed: no user or no password set');
        throw new UnauthorizedException(
          new SepError(
            ErrorCode.AUTH_INVALID_CREDENTIALS,
            {},
            'Invalid email or password',
          ).toClientJson(),
        );
      }

      // Locked accounts short-circuit before password check. Keeps
      // the atomic UPDATE simple (no "already locked" branch) and
      // gives the user a distinct error code so they know to wait.
      if (user.lockedUntil !== null && user.lockedUntil > new Date()) {
        throw new UnauthorizedException(
          new SepError(
            ErrorCode.AUTH_ACCOUNT_LOCKED,
            { lockedUntil: user.lockedUntil.toISOString() },
            `Account is temporarily locked until ${user.lockedUntil.toISOString()}`,
          ).toClientJson(),
        );
      }

      const valid = await argon2Verify(user.passwordHash, password);

      if (!valid) {
        await this.applyFailedLoginUpdate(tx, user.id);
        throw new UnauthorizedException(
          new SepError(
            ErrorCode.AUTH_INVALID_CREDENTIALS,
            {},
            'Invalid email or password',
          ).toClientJson(),
        );
      }

      // Success path: clear counter/lock, record login timestamp.
      await tx.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
      });

      if (user.mfaEnrolledAt !== null) {
        return this.issueMfaChallenge(user.id, user.tenantId);
      }

      const role = user.roleAssignments[0]?.role ?? 'TENANT_ADMIN';
      const payload: TokenPayload = {
        userId: user.id,
        tenantId: user.tenantId,
        role,
        email: user.email,
      };
      return this.authService.issueToken(payload);
    });
  }

  /**
   * Atomic lockout counter update. Single SQL statement; CASE
   * expressions derive the new values from the pre-image. Parallel
   * wrong-password attempts serialise on the row-level lock taken
   * by UPDATE — no two attempts both see counter=9 and both issue
   * a token.
   *
   * Returns the post-update (counter, lockedUntil) from the
   * RETURNING clause for observability; not used for control flow
   * (the caller throws AUTH_INVALID_CREDENTIALS either way — we
   * don't leak "you just triggered lockout" in the response).
   */
  private async applyFailedLoginUpdate(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<LockoutUpdateRow | null> {
    const rows = await tx.$queryRaw<LockoutUpdateRow[]>`
      UPDATE users SET
        "failedLoginAttempts" = CASE
          WHEN "lastFailedAt" IS NULL
            OR "lastFailedAt" < NOW() - (${LOCKOUT_WINDOW_MINUTES} || ' minutes')::interval
          THEN 1
          WHEN "failedLoginAttempts" + 1 >= ${LOCKOUT_THRESHOLD} THEN ${LOCKOUT_THRESHOLD}
          ELSE "failedLoginAttempts" + 1
        END,
        "lockedUntil" = CASE
          WHEN "lastFailedAt" IS NULL
            OR "lastFailedAt" < NOW() - (${LOCKOUT_WINDOW_MINUTES} || ' minutes')::interval
          THEN "lockedUntil"
          WHEN "failedLoginAttempts" + 1 >= ${LOCKOUT_THRESHOLD}
          THEN NOW() + (${LOCKOUT_DURATION_MINUTES} || ' minutes')::interval
          ELSE "lockedUntil"
        END,
        "lastFailedAt" = NOW()
      WHERE id = ${userId}
      RETURNING "failedLoginAttempts", "lockedUntil"
    `;

    const result = rows[0] ?? null;
    if (result === null) {
      logger.warn({ userId }, 'Lockout UPDATE returned 0 rows (RLS tenant mismatch or race)');
      return null;
    }
    if (result.lockedUntil !== null && result.lockedUntil > new Date()) {
      logger.warn(
        { userId, lockedUntil: result.lockedUntil.toISOString() },
        'Account crossed lockout threshold',
      );
    }
    return result;
  }

  private issueMfaChallenge(userId: string, tenantId: string): MfaChallengeToken {
    const cfg = getConfig();
    const challengeId = randomUUID();
    const mfaChallengeToken = this.jwtService.sign(
      { typ: 'mfa_challenge', userId, tenantId, challengeId },
      {
        secret: cfg.auth.jwtSecret,
        expiresIn: MFA_CHALLENGE_EXPIRY,
        issuer: cfg.auth.jwtIssuer,
        algorithm: 'HS256',
      },
    );
    return { mfaChallengeToken, expiresIn: MFA_CHALLENGE_EXPIRY };
  }
}
