import { Controller, Post, Headers, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../../common/guards/jwt-auth.guard';
import { AuthService, type AuthTokens } from './auth.service';
import { SepError, ErrorCode } from '@sep/common';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
}
