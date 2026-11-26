/**
 * Every business permission code. Code never uses raw permission strings: it uses
 * `Permission.X`. Adding a permission means one line here plus a custom Drizzle
 * migration that inserts the `permissions` row (and `role_permissions` rows for
 * the system roles that should have it). A db spec fails when the table and this
 * constant drift apart.
 */
export const Permission = {
  BUSINESS_READ: 'business:read',
  BUSINESS_UPDATE: 'business:update',
  BRANCH_READ: 'branch:read',
  BRANCH_UPDATE: 'branch:update',
  TERMINAL_READ: 'terminal:read',
  TERMINAL_ACTIVATE: 'terminal:activate',
  TERMINAL_UPDATE: 'terminal:update',
  TERMINAL_REVOKE: 'terminal:revoke',
  MEMBER_READ: 'member:read',
  MEMBER_INVITE: 'member:invite',
  MEMBER_UPDATE: 'member:update',
  MEMBER_END: 'member:end',
  ROLE_READ: 'role:read',
  ROLE_CREATE: 'role:create',
  ROLE_UPDATE: 'role:update',
  ROLE_DELETE: 'role:delete',
  OVERRIDE_MANAGE: 'override:manage',
  AUDIT_READ: 'audit:read',
} as const;

export type PermissionKey = (typeof Permission)[keyof typeof Permission];

export const PERMISSION_KEYS: readonly PermissionKey[] =
  Object.values(Permission).sort();

export function isPermissionKey(value: unknown): value is PermissionKey {
  return (
    typeof value === 'string' &&
    (PERMISSION_KEYS as readonly string[]).includes(value)
  );
}
