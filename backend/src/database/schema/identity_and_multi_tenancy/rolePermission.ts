import {
    pgTable,
    uuid,
    text,
    primaryKey,
} from 'drizzle-orm/pg-core';
import {sql, relations} from 'drizzle-orm';
import { roles } from './roles';
import { permissions } from './permission';

// ------------------------------------------------------------------------------
// 9. ROLE PERMISSIONS
// ------------------------------------------------------------------------------
export const rolePermissions = pgTable('role_permissions', {
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permissionCode: text('permission_code').notNull().references(() => permissions.permissionCode, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.roleId, t.permissionCode] }),
]);

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, {
    fields: [rolePermissions.roleId],
    references: [roles.id],
  }),
  permission: one(permissions, {
    fields: [rolePermissions.permissionCode],
    references: [permissions.permissionCode],
  }),
}));