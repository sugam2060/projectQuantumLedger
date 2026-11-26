import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '../permission.constant';
import type { PlatformPermissionKey } from '../platform-permission.constant';

export const REQUIRED_PERMISSIONS_KEY = 'requiredPermissions';
export const REQUIRED_PLATFORM_PERMISSIONS_KEY = 'requiredPlatformPermissions';

/**
 * The caller must hold every permission in the business named by the
 * `:businessId` route parameter (and at `:branchId` when the route has one).
 * Checked by PermissionGuard through app.has_permission.
 */
export const RequiredPermission = (
  ...permissions: [PermissionKey, ...PermissionKey[]]
) => SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

/** Fortis staff must hold every platform permission (from their platform role). */
export const RequiredPlatformPermission = (
  ...permissions: [PlatformPermissionKey, ...PlatformPermissionKey[]]
) => SetMetadata(REQUIRED_PLATFORM_PERMISSIONS_KEY, permissions);
