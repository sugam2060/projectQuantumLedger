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
import {terminals} from './terminals';
import {branchAssignments} from './branchAssignment';



// ------------------------------------------------------------------------------
// 2. BRANCHES
// ------------------------------------------------------------------------------
export const branches = pgTable('branches', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  branchCode: text('branch_code').notNull(),
  name: text('name').notNull(),
  address: text('address'),
  timezone: text('timezone').default('Asia/Kathmandu').notNull(),
  status: text('status').default('active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('idx_branches_bus_code').on(t.businessId, t.branchCode),
  pgPolicy('tenant_branch_isolation_policy', {
    for: 'all',
    to: 'public',
    using: sql`current_setting('app.is_platform_support', true) = 'true' OR business_id = current_setting('app.current_business_id', true)::uuid`,
    withCheck: sql`current_setting('app.is_platform_support', true) = 'true' OR business_id = current_setting('app.current_business_id', true)::uuid`,
  }),
]).enableRLS();


export const branchesRelations = relations(branches, ({ one, many }) => ({
  business: one(businesses, {
    fields: [branches.businessId],
    references: [businesses.id],
  }),
  terminals: many(terminals),
  branchAssignments: many(branchAssignments),
}));