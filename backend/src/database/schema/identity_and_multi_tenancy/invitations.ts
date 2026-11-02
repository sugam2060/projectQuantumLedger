import {
    pgTable,
    uuid,
    text,
    timestamp,
    index,
    pgPolicy
} from 'drizzle-orm/pg-core';
import {sql, relations} from 'drizzle-orm';
import { businesses } from './businesses';
import { users } from './users';
import { roles } from './roles';
import { branches } from './branches';


// ------------------------------------------------------------------------------
// 11. INVITATIONS
// ------------------------------------------------------------------------------
export const invitations = pgTable('invitations', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  status: text('status').default('pending').notNull(),
  expiry: timestamp('expiry', { withTimezone: true }).notNull(),
  invitedBy: uuid('invited_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('idx_invitations_token_hash').on(t.tokenHash),
  pgPolicy('tenant_invitation_isolation_policy', {
    for: 'all',
    to: 'public',
    using: sql`business_id = current_setting('app.current_business_id', true)::uuid`,
    withCheck: sql`business_id = current_setting('app.current_business_id', true)::uuid`,
  }),
]).enableRLS();

export const invitationsRelations = relations(invitations, ({ one }) => ({
  business: one(businesses, {
    fields: [invitations.businessId],
    references: [businesses.id],
  }),
  role: one(roles, {
    fields: [invitations.roleId],
    references: [roles.id],
  }),
  branch: one(branches, {
    fields: [invitations.branchId],
    references: [branches.id],
  }),
  inviter: one(users, {
    fields: [invitations.invitedBy],
    references: [users.id],
  }),
}));