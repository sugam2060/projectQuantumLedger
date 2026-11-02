import { SetMetadata } from '@nestjs/common';
import { REQUIRED_ROLES } from '../auth.constants';

export const RequireRoles = (...roles: string[]) => {
  if (roles.length === 0 || roles.some((role) => role.trim().length === 0)) {
    throw new Error('RequireRoles needs at least one non-empty role');
  }

  return SetMetadata(REQUIRED_ROLES, roles);
};
