import { SetMetadata } from '@nestjs/common';
import { REQUIRED_PERMISSIONS } from '../auth.constants';

export const RequirePermissions = (...permissions: string[]) => {
  if (
    permissions.length === 0 ||
    permissions.some((permission) => permission.trim().length === 0)
  ) {
    throw new Error(
      'RequirePermissions needs at least one non-empty permission',
    );
  }

  return SetMetadata(REQUIRED_PERMISSIONS, permissions);
};
