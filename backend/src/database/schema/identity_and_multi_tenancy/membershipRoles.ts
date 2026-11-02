import {
    pgTable,
    uuid,
    timestamp,
    pgPolicy,
} from 'drizzle-orm/pg-core';
import { relations,sql } from 'drizzle-orm';
import { businessMemberships } from './businessMembership';
import { roles } from './roles';
import {businesses} from './businesses';
import {branches} from './branches';


// ------------------------------------------------------------------------------
// 10. MEMBERSHIP ROLES
// ------------------------------------------------------------------------------
export const membershipRoles = pgTable('membership_roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessMembershipId: uuid('business_membership_id').notNull().references(() => businessMemberships.id, { onDelete: 'cascade' }),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  pgPolicy('tenant_membership_role_isolation_policy', {
    for: 'all',
    to: 'public',
    using: sql`current_setting('app.is_platform_support', true) = 'true' OR business_id = current_setting('app.current_business_id', true)::uuid`,
    withCheck: sql`current_setting('app.is_platform_support', true) = 'true' OR business_id = current_setting('app.current_business_id', true)::uuid`,
  }),
]).enableRLS();

export const membershipRolesRelations = relations(membershipRoles, ({ one }) => ({
  membership: one(businessMemberships, {
    fields: [membershipRoles.businessMembershipId],
    references: [businessMemberships.id],
  }),
  role: one(roles, {
    fields: [membershipRoles.roleId],
    references: [roles.id],
  }),
  branch: one(branches, {
    fields: [membershipRoles.branchId],
    references: [branches.id],
  }),
}));