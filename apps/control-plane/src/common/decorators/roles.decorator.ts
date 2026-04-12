import { SetMetadata } from '@nestjs/common';
import type { Role } from '@sep/common';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]): ReturnType<typeof SetMetadata> =>
  SetMetadata(ROLES_KEY, roles);

export const SkipTenantCheck = (): ReturnType<typeof SetMetadata> =>
  SetMetadata('skipTenantCheck', true);
