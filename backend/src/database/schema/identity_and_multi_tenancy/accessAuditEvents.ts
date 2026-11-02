import {
    pgTable,
    uuid,
    text,
    timestamp,
    index,
    pgPolicy
} from 'drizzle-orm/pg-core';
import {sql, relations} from 'drizzle-orm';
import { branches } from './branches';
import { users } from './users';
import { businesses } from './businesses';

// ------------------------------------------------------------------------------
// 12. ACCESS AUDIT EVENTS
// ------------------------------------------------------------------------------
export const accessAuditEvents = pgTable('access_audit_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'set null' }),
  branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  targetUserId: uuid('target_user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  reason: text('reason'),
  requestId: text('request_id'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('idx_access_audit_bus_time').on(t.businessId, t.occurredAt),
  pgPolicy('tenant_access_audit_isolation_policy', {
    for: 'select',
    to: 'public',
    using: sql`business_id IS NULL OR business_id = current_setting('app.current_business_id', true)::uuid`,
  }),
]).enableRLS();

export const accessAuditEventsRelations = relations(accessAuditEvents, ({ one }) => ({
  business: one(businesses, {
    fields: [accessAuditEvents.businessId],
    references: [businesses.id],
  }),
  branch: one(branches, {
    fields: [accessAuditEvents.branchId],
    references: [branches.id],
  }),
  actor: one(users, {
    fields: [accessAuditEvents.actorUserId],
    references: [users.id],
  }),
  targetUser: one(users, {
    fields: [accessAuditEvents.targetUserId],
    references: [users.id],
  }),
}));