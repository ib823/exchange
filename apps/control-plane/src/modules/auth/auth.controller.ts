import { Controller, Post, Headers, Body, HttpCode, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Public } from '../../common/guards/jwt-auth.guard';
import { AuthService, type AuthTokens, type TokenPayload } from './auth.service';
import { LoginService, type LoginResult } from './login.service';
import { RefreshTokenService, type IssuedRefreshToken } from './refresh-token.service';
import { DatabaseService } from '@sep/db';
import { SepError, ErrorCode } from '@sep/common';

const LoginSchema = z.object({
  tenantId: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
});
class LoginDto extends createZodDto(LoginSchema) {}

const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});
class RefreshDto extends createZodDto(RefreshSchema) {}

export interface RefreshResponse {
  readonly accessToken: string;
  readonly expiresIn: string;
  readonly refreshToken: IssuedRefreshToken;
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly loginService: LoginService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly database: DatabaseService,
  ) {}

  @Public()
  @Post('token')
  @ApiOperation({ summary: 'Exchange API key for JWT access token' })
  @ApiResponse({ status: 200, description: 'Token issued' })
  @ApiResponse({ status: 401, description: 'Invalid or expired API key' })
  async token(@Headers('x-api-key') apiKey: string | undefined): Promise<AuthTokens> {
    if (apiKey === undefined || apiKey.trim() === '') {
      throw new UnauthorizedException(new SepError(ErrorCode.AUTH_API_KEY_INVALID).toClientJson());
    }
    const payload = await this.authService.validateApiKey(apiKey);
    return this.authService.issueToken(payload);
  }

  /**
   * Password login. Returns either:
   *   - `{ accessToken, expiresIn }` — user has no MFA enrolled
   *   - `{ mfaChallengeToken, expiresIn }` — caller must POST to
   *     /auth/mfa/verify with the challenge token + TOTP code (T04)
   *
   * On wrong credentials: returns 401 `AUTH_INVALID_CREDENTIALS`
   * and silently increments the lockout counter. On lockout:
   * returns 401 `AUTH_ACCOUNT_LOCKED` with the unlock timestamp.
   */
  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Password login with MFA branching and lockout policy (10/30/30)' })
  @ApiResponse({ status: 200, description: 'Login successful — tokens or MFA challenge' })
  @ApiResponse({ status: 401, description: 'Invalid credentials or account locked' })
  async login(@Body() body: LoginDto): Promise<LoginResult> {
    return this.loginService.validatePassword(body.tenantId, body.email, body.password);
  }

  /**
   * Refresh token rotation with strict replay detection.
   *
   * Happy path: valid unused token → issue a new token with
   * `replacedById` pointing at the old, mark the old as usedAt,
   * return new access + refresh pair.
   *
   * Replay path: presenting a token whose usedAt is already set
   * triggers chain revocation (every token linked by replacedById
   * in both directions) and returns AUTH_REFRESH_TOKEN_REPLAY.
   * User must log in again.
   */
  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate refresh token; strict replay detection (HMAC-SHA256)' })
  @ApiResponse({ status: 200, description: 'New access + refresh tokens issued' })
  @ApiResponse({
    status: 401,
    description:
      'Token invalid/expired/revoked (`AUTH_REFRESH_TOKEN_INVALID`) or replay detected (`AUTH_REFRESH_TOKEN_REPLAY`)',
  })
  async refresh(@Body() body: RefreshDto): Promise<RefreshResponse> {
    const result = await this.refreshTokenService.refresh(body.refreshToken);
    // Fetch the user's role so the new access token carries the
    // same TokenPayload shape as login issuance. Single lookup
    // inside forTenant — the tenant context is known and
    // authenticated via the refresh token row.
    const role = await this.database.forTenant(result.tenantId, async (tx) => {
      const assignments = await tx.roleAssignment.findMany({
        where: { userId: result.userId },
        select: { role: true },
        take: 1,
      });
      return assignments[0]?.role ?? 'TENANT_ADMIN';
    });
    const email = await this.database.forTenant(result.tenantId, async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: result.userId },
        select: { email: true },
      });
      return user?.email ?? '';
    });
    const payload: TokenPayload = {
      userId: result.userId,
      tenantId: result.tenantId,
      role,
      email,
    };
    const accessTokens = this.authService.issueToken(payload);
    return {
      accessToken: accessTokens.accessToken,
      expiresIn: accessTokens.expiresIn,
      refreshToken: result.refreshToken,
    };
  }
}
