import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgPolicy,
} from 'drizzle-orm/pg-core';
import {sql, relations} from 'drizzle-orm';
import { roles } from './roles';
import { businessMemberships } from './businessMembership';


// ------------------------------------------------------------------------------
// 4. USERS (Global Identity Table)
// ------------------------------------------------------------------------------
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  displayName: text('display_name').notNull(),
  status: text('status').default('active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  pgPolicy('users_self_or_platform_access_policy', {
    for: 'all',
    to: 'public',
    using: sql`
      id = NULLIF(current_setting('app.current_user_id', true), '')::uuid 
      OR current_setting('app.is_platform_support', true) = 'true'
    `,
    withCheck: sql`
      id = NULLIF(current_setting('app.current_user_id', true), '')::uuid 
      OR current_setting('app.is_platform_support', true) = 'true'
    `,
  }),
]).enableRLS();

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(businessMemberships),
  createdRoles: many(roles),
}));