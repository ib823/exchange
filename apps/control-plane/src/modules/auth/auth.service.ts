import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getPrismaClient } from '@sep/db';
import { SepError, ErrorCode, getConfig } from '@sep/common';
import { createLogger } from '@sep/observability';
import { compare } from 'bcrypt';
import { randomUUID } from 'crypto';

const logger = createLogger({ service: 'control-plane', module: 'auth' });

export interface TokenPayload {
  userId: string;
  tenantId: string;
  role: string;
  email: string;
}

export interface AuthTokens {
  accessToken: string;
  expiresIn: string;
}

@Injectable()
export class AuthService {
  private readonly db = getPrismaClient();

  constructor(private readonly jwtService: JwtService) {}

  async validateApiKey(rawKey: string): Promise<TokenPayload> {
    const prefix = rawKey.slice(0, 8);

    const apiKey = await this.db.apiKey.findFirst({
      where: { prefix, active: true },
    });

    if (apiKey === null) {
      throw new UnauthorizedException(
        new SepError(ErrorCode.AUTH_API_KEY_INVALID).toClientJson(),
      );
    }

    const valid = await compare(rawKey, apiKey.keyHash);
    if (!valid) {
      throw new UnauthorizedException(
        new SepError(ErrorCode.AUTH_API_KEY_INVALID).toClientJson(),
      );
    }

    if (apiKey.expiresAt !== null && apiKey.expiresAt < new Date()) {
      throw new UnauthorizedException(
        new SepError(ErrorCode.AUTH_API_KEY_INVALID, { reason: 'expired' }).toClientJson(),
      );
    }

    // Check tenant status separately (no FK relation on ApiKey)
    const tenant = await this.db.tenant.findUnique({
      where: { id: apiKey.tenantId },
      select: { status: true },
    });

    if (tenant === null || tenant.status !== 'ACTIVE') {
      throw new UnauthorizedException(
        new SepError(ErrorCode.TENANT_SUSPENDED).toClientJson(),
      );
    }

    // Update last used timestamp (non-blocking)
    void this.db.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    }).catch((err: unknown) => {
      logger.warn({ err }, 'Failed to update apiKey.lastUsedAt');
    });

    return {
      userId: apiKey.id,
      tenantId: apiKey.tenantId,
      role: apiKey.role,
      email: `apikey:${prefix}`,
    };
  }

  issueToken(payload: TokenPayload): AuthTokens {
    const cfg = getConfig();
    const accessToken = this.jwtService.sign(payload, {
      secret: cfg.auth.jwtSecret,
      expiresIn: cfg.auth.jwtExpiry,
      issuer: cfg.auth.jwtIssuer,
      jwtid: randomUUID(),
    });
    return { accessToken, expiresIn: cfg.auth.jwtExpiry };
  }
}
