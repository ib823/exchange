import {
  Injectable, type CanActivate, type ExecutionContext,
  UnauthorizedException, SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { getConfig, SepError, ErrorCode } from '@sep/common';
import type { FastifyRequest } from 'fastify';

export const IS_PUBLIC = 'isPublic';

/**
 * Decorator to mark routes as public (no JWT required).
 * Use sparingly — health checks and auth endpoints only.
 * Every other route is authenticated by default.
 */
export const Public = (): ReturnType<typeof SetMetadata> =>
  SetMetadata(IS_PUBLIC, true);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly jwtService: JwtService;
  private readonly reflector: Reflector;

  constructor(jwtService: JwtService, reflector: Reflector) {
    this.jwtService = jwtService;
    this.reflector = reflector;
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = this.extractToken(request);

    if (token === null) {
      throw new UnauthorizedException(
        new SepError(ErrorCode.AUTH_TOKEN_INVALID).toClientJson(),
      );
    }

    try {
      const cfg = getConfig();
      const payload = this.jwtService.verify<{
        userId: string;
        tenantId: string;
        role: string;
        email: string;
      }>(token, { secret: cfg.auth.jwtSecret, issuer: cfg.auth.jwtIssuer });

      // Attach to request for downstream guards and services
      (request as FastifyRequest & { user: unknown }).user = payload;
      return true;
    } catch {
      throw new UnauthorizedException(
        new SepError(ErrorCode.AUTH_TOKEN_EXPIRED).toClientJson(),
      );
    }
  }

  private extractToken(request: FastifyRequest): string | null {
    const authHeader = request.headers.authorization;
    if (typeof authHeader !== 'string') {
      return null;
    }
    const [scheme, token] = authHeader.split(' ');
    if (scheme?.toLowerCase() !== 'bearer') {
      return null;
    }
    return token ?? null;
  }
}
