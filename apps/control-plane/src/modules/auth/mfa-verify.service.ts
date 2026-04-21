/**
 * MFA challenge verification — exchange a challenge token + TOTP
 * code for an access token (M3.A4-T04).
 *
 * Flow:
 *   1. Verify the challenge JWT (HS256, issuer match, not expired,
 *      typ == 'mfa_challenge').
 *   2. Atomically consume the challengeId via
 *      MfaChallengeStore.consume — first call wins; replays fail
 *      closed with AUTH_MFA_CHALLENGE_CONSUMED.
 *   3. Retrieve the TOTP secret from Vault via MfaSecretVaultService.
 *   4. Verify the TOTP code with the same ±1 window tolerance the
 *      enrollment path uses.
 *   5. Issue the access token via AuthService.issueToken.
 *
 * Challenge burns on first attempt:
 *   Wrong TOTP code = challenge is still consumed. User must
 *   restart login. Prevents brute-force of the 6-digit TOTP space
 *   against a single issued challenge token.
 */

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { verify as otpVerify } from 'otplib';
import { DatabaseService } from '@sep/db';
import { SepError, ErrorCode, getConfig } from '@sep/common';
import { createLogger } from '@sep/observability';
import { AuthService, type AuthTokens, type TokenPayload } from './auth.service';
import { MfaChallengeStore } from './mfa-challenge-store.service';
import { MfaSecretVaultService } from './mfa-secret-vault.service';
import { RefreshTokenService, type IssuedRefreshToken } from './refresh-token.service';

const logger = createLogger({ service: 'control-plane', module: 'mfa-verify' });

const TOTP_EPOCH_TOLERANCE_SECONDS = 30;

interface MfaChallengeJwtPayload {
  readonly typ: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly challengeId: string;
}

@Injectable()
export class MfaVerifyService {
  constructor(
    private readonly database: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
    private readonly challengeStore: MfaChallengeStore,
    private readonly mfaVault: MfaSecretVaultService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  async verify(
    challengeToken: string,
    totpCode: string,
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

    // Atomic single-use: first call wins, replay fails. Done BEFORE
    // the TOTP check so a wrong TOTP burns the challenge (see service
    // header for the tradeoff rationale).
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

    return this.database.forTenant(payload.tenantId, async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: payload.userId },
        select: {
          id: true,
          tenantId: true,
          email: true,
          mfaSecretRef: true,
          mfaEnrolledAt: true,
          roleAssignments: { select: { role: true }, take: 1 },
        },
      });

      if (
        user?.mfaSecretRef === null ||
        user?.mfaSecretRef === undefined ||
        user.mfaEnrolledAt === null
      ) {
        // Shouldn't happen — a challenge token was issued for this
        // user, which requires mfaEnrolledAt != null. If the user
        // reset MFA in the 5-min window, the challenge is stale.
        throw new UnauthorizedException(
          new SepError(
            ErrorCode.AUTH_MFA_CHALLENGE_INVALID,
            { reason: 'User MFA state changed since challenge was issued' },
            'MFA challenge token is invalid or expired',
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
        logger.info(
          { userId: user.id, tenantId: user.tenantId },
          'MFA verify rejected: wrong TOTP code (challenge consumed)',
        );
        throw new UnauthorizedException(
          new SepError(ErrorCode.AUTH_TOKEN_INVALID, {}, 'TOTP code did not verify').toClientJson(),
        );
      }

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
        'MFA challenge completed, access + refresh tokens issued',
      );
      return { ...accessTokens, refreshToken };
    });
  }
}
