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
import { branches } from './branches';
import { businessMemberships } from './businessMembership';

// ------------------------------------------------------------------------------
// 6. BRANCH ASSIGNMENTS
// ------------------------------------------------------------------------------
export const branchAssignments = pgTable('branch_assignments', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessMembershipId: uuid('business_membership_id').notNull().references(() => businessMemberships.id, { onDelete: 'cascade' }),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'cascade' }),
  status: text('status').default('active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('idx_branch_assignments_unique').on(t.businessMembershipId, t.branchId),
  pgPolicy('tenant_branch_assignment_isolation_policy', {
    for: 'all',
    to: 'public',
    using: sql`current_setting('app.is_platform_support', true) = 'true' OR business_id = current_setting('app.current_business_id', true)::uuid`,
    withCheck: sql`current_setting('app.is_platform_support', true) = 'true' OR business_id = current_setting('app.current_business_id', true)::uuid`,
  }),
]).enableRLS();

export const branchAssignmentsRelations = relations(branchAssignments, ({ one }) => ({
  membership: one(businessMemberships, {
    fields: [branchAssignments.businessMembershipId],
    references: [businessMemberships.id],
  }),
  business: one(businesses, {
    fields: [branchAssignments.businessId],
    references: [businesses.id],
  }),
  branch: one(branches, {
    fields: [branchAssignments.branchId],
    references: [branches.id],
  }),
}));