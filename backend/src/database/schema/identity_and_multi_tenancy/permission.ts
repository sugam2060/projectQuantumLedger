import {
    pgTable,
    uuid,
    text,
    timestamp,
    uniqueIndex,
    pgPolicy
} from 'drizzle-orm/pg-core';
import {sql, relations} from 'drizzle-orm';
import {rolePermissions} from './rolePermission';

// ------------------------------------------------------------------------------
// 8. PERMISSIONS (Global Catalog Reference Table)
// ------------------------------------------------------------------------------
export const permissions = pgTable('permissions', {
  permissionCode: text('permission_code').primaryKey(),
  method: text('method'),
  routePattern: text('route_pattern'),
  description: text('description'),
  module: text('module').notNull(),
  riskLevel: text('risk_level').default('normal').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const permissionsRelations = relations(permissions, ({ many }) => ({
  roles: many(rolePermissions),
}));