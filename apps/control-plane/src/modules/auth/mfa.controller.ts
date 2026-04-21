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
import { MfaService, type MfaEnrollResult, type MfaActivateResult } from './mfa.service';
import type { TokenPayload } from './auth.service';
import type { FastifyRequest } from 'fastify';

const ActivateSchema = z.object({
  code: z.string().regex(/^[0-9]{6}$/, 'TOTP code must be 6 digits'),
});
class ActivateDto extends createZodDto(ActivateSchema) {}

@ApiTags('Auth')
@ApiBearerAuth()
@Controller('auth/mfa')
export class MfaController {
  constructor(private readonly mfaService: MfaService) {}

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
}
