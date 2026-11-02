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
import { branchAssignments } from './branchAssignment';
import {membershipRoles} from './membershipRoles';

// ------------------------------------------------------------------------------
// 5. BUSINESS MEMBERSHIPS
// ------------------------------------------------------------------------------
export const businessMemberships = pgTable('business_memberships', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').default('active').notNull(),
  invitedBy: uuid('invited_by').references(() => users.id),
  joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('idx_memberships_bus_user').on(t.businessId, t.userId),
  pgPolicy('tenant_membership_isolation_policy', {
    for: 'all',
    to: 'public',
    using: sql`current_setting('app.is_platform_support', true) = 'true' OR business_id = current_setting('app.current_business_id', true)::uuid`,
    withCheck: sql`current_setting('app.is_platform_support', true) = 'true' OR business_id = current_setting('app.current_business_id', true)::uuid`,
  }),
]).enableRLS();



export const businessMembershipsRelations = relations(businessMemberships, ({ one, many }) => ({
  business: one(businesses, {
    fields: [businessMemberships.businessId],
    references: [businesses.id],
  }),
  user: one(users, {
    fields: [businessMemberships.userId],
    references: [users.id],
  }),
  branchAssignments: many(branchAssignments),
  assignedRoles: many(membershipRoles),
}));