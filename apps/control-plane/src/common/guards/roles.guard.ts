import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { SepError, ErrorCode } from '@sep/common';
import type { AuthenticatedRequest } from './tenant.guard';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required === undefined || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Partial<AuthenticatedRequest>>();
    if (request.user === undefined) {
      throw new ForbiddenException('No authenticated user');
    }
    const { user } = request as AuthenticatedRequest;

    if (!required.includes(user.role)) {
      throw new ForbiddenException(
        new SepError(ErrorCode.RBAC_INSUFFICIENT_ROLE, {
          requiredRole: required.join(','),
          actualRole: user.role,
        }).toClientJson(),
      );
    }
    return true;
  }
}
