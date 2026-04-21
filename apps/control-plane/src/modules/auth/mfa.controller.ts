/**
 * MFA enrollment + activation endpoints (M3.A4-T02).
 *
 * Both routes require JWT — the user must already be authenticated
 * via the existing API-key → JWT exchange. MFA is a second factor,
 * not a primary auth path; an unauthenticated caller has nothing
 * to enroll.
 */

import { Controller, Post, Body, HttpCode, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Public } from '../../common/guards/jwt-auth.guard';
import { MfaService, type MfaEnrollResult, type MfaActivateResult } from './mfa.service';
import { MfaVerifyService } from './mfa-verify.service';
import { MfaRecoverService } from './mfa-recover.service';
import type { AuthTokens, TokenPayload } from './auth.service';
import type { IssuedRefreshToken } from './refresh-token.service';
import type { FastifyRequest } from 'fastify';

const ActivateSchema = z.object({
  code: z.string().regex(/^[0-9]{6}$/, 'TOTP code must be 6 digits'),
});
class ActivateDto extends createZodDto(ActivateSchema) {}

const VerifySchema = z.object({
  challengeToken: z.string().min(1),
  code: z.string().regex(/^[0-9]{6}$/, 'TOTP code must be 6 digits'),
});
class VerifyDto extends createZodDto(VerifySchema) {}

const RecoverSchema = z.object({
  challengeToken: z.string().min(1),
  // Recovery codes are 8 base32 chars (see MfaService enrollment).
  // Accept uppercase to match the format the user was shown at
  // enrollment; a case-insensitive compare would require normalising
  // before the argon2 walk, and users who copy-paste typically
  // preserve case.
  recoveryCode: z
    .string()
    .regex(/^[A-Z0-9]{8}$/, 'Recovery code must be 8 upper-case base32 chars'),
});
class RecoverDto extends createZodDto(RecoverSchema) {}

@ApiTags('Auth')
@ApiBearerAuth()
@Controller('auth/mfa')
export class MfaController {
  constructor(
    private readonly mfaService: MfaService,
    private readonly mfaVerifyService: MfaVerifyService,
    private readonly mfaRecoverService: MfaRecoverService,
  ) {}

  @Post('enroll')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Begin MFA enrollment — generate a TOTP secret, store in Vault, return provisioning material',
  })
  @ApiResponse({
    status: 200,
    description: 'Secret generated; client should render the QR and collect a TOTP code',
  })
  @ApiResponse({ status: 409, description: 'MFA already activated for this user' })
  async enroll(@Request() req: FastifyRequest): Promise<MfaEnrollResult> {
    const user = (req as FastifyRequest & { user: TokenPayload }).user;
    return this.mfaService.enroll(user.userId, user.tenantId, user.email);
  }

  @Post('activate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Confirm MFA enrollment with a TOTP code, issue recovery codes',
  })
  @ApiResponse({
    status: 200,
    description:
      'MFA activated; recovery codes returned ONCE — client must display and the user must record them',
  })
  @ApiResponse({ status: 400, description: 'TOTP code did not verify, or enrollment not started' })
  @ApiResponse({ status: 409, description: 'MFA already activated for this user' })
  async activate(
    @Request() req: FastifyRequest,
    @Body() body: ActivateDto,
  ): Promise<MfaActivateResult> {
    const user = (req as FastifyRequest & { user: TokenPayload }).user;
    return this.mfaService.activate(user.userId, user.tenantId, body.code);
  }

  /**
   * Complete the MFA challenge from the login flow (T03). Caller
   * presents the challenge token + TOTP code; service burns the
   * challengeId in Redis (single-use), verifies the code, issues
   * an access token.
   *
   * This endpoint is PUBLIC because the user does not yet have an
   * access token — the challenge token is the bridging credential.
   */
  @Public()
  @Post('verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Complete MFA challenge — exchange challenge + TOTP for access token' })
  @ApiResponse({ status: 200, description: 'Access token issued' })
  @ApiResponse({
    status: 401,
    description:
      'Challenge invalid/expired (`AUTH_MFA_CHALLENGE_INVALID`), already consumed (`AUTH_MFA_CHALLENGE_CONSUMED`), or TOTP mismatch (`AUTH_TOKEN_INVALID`)',
  })
  async verify(
    @Body() body: VerifyDto,
  ): Promise<AuthTokens & { refreshToken: IssuedRefreshToken }> {
    return this.mfaVerifyService.verify(body.challengeToken, body.code);
  }

  /**
   * Alternate bridge: exchange challenge + one recovery code for
   * tokens. For users who have lost the TOTP device but still hold
   * a recovery code. Brute-force protected (1s / 5s delay + lockout
   * after third wrong attempt within 30 min).
   */
  @Public()
  @Post('recover')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Complete MFA with a one-time recovery code (TOTP device lost / unavailable)',
  })
  @ApiResponse({
    status: 200,
    description: 'Access + refresh tokens issued; recovery code consumed',
  })
  @ApiResponse({
    status: 401,
    description:
      'Challenge invalid/consumed or recovery code mismatch (`AUTH_RECOVERY_CODE_INVALID`). Third consecutive mismatch locks the account (`AUTH_ACCOUNT_LOCKED`).',
  })
  async recover(
    @Body() body: RecoverDto,
  ): Promise<AuthTokens & { refreshToken: IssuedRefreshToken }> {
    return this.mfaRecoverService.recover(body.challengeToken, body.recoveryCode);
  }
}
