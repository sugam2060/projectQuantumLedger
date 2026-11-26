import { sql } from 'drizzle-orm';
import {
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { permissions } from './permissions';
import { roles } from './roles';

/** Which permissions a role grants. System-role rows are seeded and fixed. */
export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionKey: text('permission_key')
      .notNull()
      .references(() => permissions.key, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.permissionKey] }),
    // Visible when the role itself is visible (roles RLS applies inside).
    pgPolicy('role_permissions_select', {
      for: 'select',
      to: 'fortis_app',
      using: sql`EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id)`,
    }),
    pgPolicy('role_permissions_insert', {
      for: 'insert',
      to: 'fortis_app',
      withCheck: sql`app.can_manage_role(role_id)`,
    }),
    pgPolicy('role_permissions_delete', {
      for: 'delete',
      to: 'fortis_app',
      using: sql`app.can_manage_role(role_id)`,
    }),
  ],
).enableRLS();
