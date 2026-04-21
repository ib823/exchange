import { Controller, Post, Headers, Body, HttpCode, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Public } from '../../common/guards/jwt-auth.guard';
import { AuthService, type AuthTokens } from './auth.service';
import { LoginService, type LoginResult } from './login.service';
import { SepError, ErrorCode } from '@sep/common';

const LoginSchema = z.object({
  tenantId: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
});
class LoginDto extends createZodDto(LoginSchema) {}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly loginService: LoginService,
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
}
