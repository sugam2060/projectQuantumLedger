import { Injectable } from '@nestjs/common';
import { AuthorizationRepository } from './authorization.repository';
import { isPermissionKey, type PermissionKey } from './permission.constant';
import {
  PLATFORM_ROLE_PERMISSIONS,
  PLATFORM_ROLES,
  type PlatformPermissionKey,
  type PlatformRole,
} from './platform-permission.constant';

/**
 * Permission checks. Business permissions are decided by the database
 * (app.has_permission: owner, branch scope, overrides, role grants), so the API
 * and the RLS policies can never disagree. Platform permissions come from the
 * platform role in the access token.
 */
@Injectable()
export class PermissionService {
  constructor(private readonly repository: AuthorizationRepository) {}

  /** True only when the user holds every listed permission. */
  hasAll(
    userId: string,
    businessId: string,
    branchId: string | undefined,
    permissions: readonly PermissionKey[],
  ): Promise<boolean> {
    if (permissions.length === 0) return Promise.resolve(false);
    return this.repository.hasAll(userId, businessId, branchId, permissions);
  }

  /** The user's effective permissions, sorted. */
  async effective(
    userId: string,
    businessId: string,
    branchId?: string,
  ): Promise<PermissionKey[]> {
    const keys = await this.repository.effective(userId, businessId, branchId);
    return keys.filter(isPermissionKey);
  }

  /** Platform staff: bootstrap users act as admin; unknown roles get nothing. */
  platformHasAll(
    staff: { isBootstrap?: boolean; platformRole?: string },
    permissions: readonly PlatformPermissionKey[],
  ): boolean {
    if (permissions.length === 0) return false;
    const role = staff.isBootstrap ? 'admin' : staff.platformRole;
    if (!isPlatformRole(role)) return false;
    const granted = PLATFORM_ROLE_PERMISSIONS[role];
    return permissions.every((permission) => granted.includes(permission));
  }
}

function isPlatformRole(value: unknown): value is PlatformRole {
  return (
    typeof value === 'string' &&
    (PLATFORM_ROLES as readonly string[]).includes(value)
  );
}
