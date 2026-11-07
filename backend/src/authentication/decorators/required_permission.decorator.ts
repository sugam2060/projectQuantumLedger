import { SetMetadata } from '@nestjs/common';
import { PermissionName } from '../../database/permission.constant';

export const REQUIRED_PERMISSION = 'required_permission';

export const RequiredPermission = (...permissions: PermissionName[]) =>
  SetMetadata(REQUIRED_PERMISSION, permissions);
