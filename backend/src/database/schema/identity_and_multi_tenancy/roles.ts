import {
    pgTable,
    uuid,
    text,
    timestamp,
    uniqueIndex,
    pgPolicy
} from 'drizzle-orm/pg-core';
import {sql, relations} from 'drizzle-orm';
import { businesses } from './businesses';
import { users } from './users';
import { rolePermissions } from './rolePermission';
import { membershipRoles } from './membershipRoles';

// ------------------------------------------------------------------------------
// 7. ROLES
// ------------------------------------------------------------------------------
export const roles = pgTable('roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  roleCode: text('role_code').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  scopeMode: text('scope_mode').default('branch').notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('idx_roles_bus_code').on(t.businessId, t.roleCode),
  pgPolicy('tenant_role_isolation_policy', {
    for: 'all',
    to: 'public',
    using: sql`current_setting('app.is_platform_support', true) = 'true' OR business_id = current_setting('app.current_business_id', true)::uuid`,
    withCheck: sql`current_setting('app.is_platform_support', true) = 'true' OR business_id = current_setting('app.current_business_id', true)::uuid`,
  }),
]).enableRLS();

export const rolesRelations = relations(roles, ({ one, many }) => ({
  business: one(businesses, {
    fields: [roles.businessId],
    references: [businesses.id],
  }),
  permissions: many(rolePermissions),
  memberAssignments: many(membershipRoles),
}));