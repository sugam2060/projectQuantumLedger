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
import {branches} from './branches';


// ------------------------------------------------------------------------------
// 3. TERMINALS
// ------------------------------------------------------------------------------
export const terminals = pgTable('terminals', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'cascade' }),
  terminalCode: text('terminal_code').notNull(),
  deviceFingerprint: text('device_fingerprint'),
  appVersion: text('app_version'),
  status: text('status').default('active').notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('idx_terminals_bus_code').on(t.businessId, t.terminalCode),
  pgPolicy('tenant_terminal_isolation_policy', {
    for: 'all',
    to: 'public',
    using: sql`business_id = current_setting('app.current_business_id', true)::uuid AND branch_id = current_setting('app.current_branch_id', true)::uuid`,
    withCheck: sql`business_id = current_setting('app.current_business_id', true)::uuid AND branch_id = current_setting('app.current_branch_id', true)::uuid`,
  }),
]).enableRLS();


export const terminalsRelations = relations(terminals, ({ one }) => ({
  business: one(businesses, {
    fields: [terminals.businessId],
    references: [businesses.id],
  }),
  branch: one(branches, {
    fields: [terminals.branchId],
    references: [branches.id],
  }),
}));