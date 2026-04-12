import {
  Injectable, type CanActivate, type ExecutionContext,
  ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SepError, ErrorCode } from '@sep/common';
import type { FastifyRequest } from 'fastify';

export const SKIP_TENANT_CHECK = 'skipTenantCheck';

export interface AuthenticatedRequest extends FastifyRequest {
  user: {
    userId: string;
    tenantId: string;
    role: string;
    email: string;
  };
}

/**
 * Tenant boundary guard.
 *
 * Enforces that the tenantId in the request path/body matches
 * the tenantId from the authenticated JWT/API key.
 *
 * PLATFORM_SUPER_ADMIN is the only role that can cross tenant boundaries.
 *
 * Apply globally or per-controller. Use @SkipTenantCheck() on handlers
 * that are intentionally cross-tenant (e.g. platform admin listing all tenants).
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_CHECK, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skip === true) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = (request as Partial<AuthenticatedRequest>).user;

    if (user === undefined) {
      throw new ForbiddenException('No authenticated user in request context');
    }

    // Platform super admin can access any tenant
    if (user.role === 'PLATFORM_SUPER_ADMIN') {
      return true;
    }

    // Extract tenantId from path params or body
    const pathTenantId = (request.params as Record<string, string>)['tenantId'];
    const bodyTenantId = (request.body as Record<string, unknown> | undefined)?.['tenantId'];
    const requestedTenantId = pathTenantId ?? bodyTenantId;

    if (requestedTenantId === undefined) {
      // No tenantId in request — allow through, service layer enforces boundary
      return true;
    }

    if (requestedTenantId !== user.tenantId) {
      // Audit-worthy event — do not reveal which tenant exists
      const corrId = request.headers['x-correlation-id'];
      const ctx: Record<string, unknown> = {};
      if (typeof corrId === 'string') {
        ctx['correlationId'] = corrId;
      }
      throw new ForbiddenException(
        new SepError(ErrorCode.TENANT_BOUNDARY_VIOLATION, ctx).toClientJson(),
      );
    }

    return true;
  }
}

/**
 * Verify object-level tenant ownership in service layer.
 * Call this for every database record fetch.
 *
 * @throws ForbiddenException if record belongs to different tenant
 * @throws NotFoundException if record not found (prevents tenant enumeration)
 */
export function assertTenantOwnership(
  recordTenantId: string | null | undefined,
  requestTenantId: string,
  resourceName: string = 'resource',
): void {
  if (recordTenantId === null || recordTenantId === undefined) {
    // Record not found — use 404 not 403 to prevent enumeration
    throw new NotFoundException(`${resourceName} not found`);
  }

  if (recordTenantId !== requestTenantId) {
    throw new ForbiddenException(
      new SepError(ErrorCode.TENANT_BOUNDARY_VIOLATION, {
        resourceType: resourceName,
      }).toClientJson(),
    );
  }
}
