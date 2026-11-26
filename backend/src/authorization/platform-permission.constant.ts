/**
 * Permissions of Fortis staff (platform users). They are not stored per user:
 * a platform user's `role` maps to a fixed set here.
 */
export const PlatformPermission = {
  BUSINESS_READ: 'platform:business:read',
  BUSINESS_PROVISION: 'platform:business:provision',
  BRANCH_CREATE: 'platform:branch:create',
  PLATFORM_USER_INVITE: 'platform:user:invite',
} as const;

export type PlatformPermissionKey =
  (typeof PlatformPermission)[keyof typeof PlatformPermission];

/** Platform roles (platform_users.role). Bootstrap users always act as admin. */
export const PLATFORM_ROLES = ['admin', 'manager', 'support'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const PLATFORM_ROLE_PERMISSIONS: Record<
  PlatformRole,
  readonly PlatformPermissionKey[]
> = {
  admin: Object.values(PlatformPermission),
  manager: [
    PlatformPermission.BUSINESS_READ,
    PlatformPermission.BUSINESS_PROVISION,
    PlatformPermission.BRANCH_CREATE,
  ],
  support: [PlatformPermission.BUSINESS_READ],
};
