import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgPolicy,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    emailNormalized: text('email_normalized').notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Unique index on normalized global email
    uniqueIndex('users_email_uq').on(table.emailNormalized),

    // Check constraints to enforce data hygiene
    check(
      'users_email_chk',
      sql`email_normalized = lower(btrim(email_normalized))`,
    ),
    check('users_status_chk', sql`status IN ('active', 'disabled')`),

    // RLS Policy for user registration via valid invitation redemption
    pgPolicy('users_insert', {
      for: 'insert',
      to: 'fortis_app',
      withCheck: sql`
        EXISTS (
          SELECT 1 FROM owner_redemptions r
          WHERE r.email_normalized = users.email_normalized
            AND r.token_hash = NULLIF(current_setting('app.owner_redemption_hash', true), '')
            AND r.consumed_at IS NULL
            AND r.revoked_at IS NULL
            AND r.expires_at > now()
        )
        OR app.is_platform_user()
      `,
    }),

    // RLS Policy for viewing users:
    // - A user can always view their own global profile.
    // - Coworkers within the same active business session can see each other via business_memberships.
    // - Platform admins have global visibility.
    pgPolicy('users_select', {
      for: 'select',
      to: 'fortis_app',
      using: sql`
        id = app.current_user_id()
        OR (
          email_normalized = NULLIF(current_setting('app.registration_email', true), '')
          AND EXISTS (
          SELECT 1 FROM owner_redemptions r
          WHERE r.email_normalized = users.email_normalized
            AND r.token_hash = NULLIF(current_setting('app.owner_redemption_hash', true), '')
            AND r.consumed_at IS NULL
            AND r.revoked_at IS NULL
            AND r.expires_at > now()
        )
        )
        OR EXISTS (
          SELECT 1 FROM business_memberships m
          WHERE m.user_id = users.id
            AND m.is_active
            AND app.has_permission(m.business_id, m.branch_id, 'member:read')
        )
        OR app.is_platform_user()
      `,
    }),

    // RLS Policy for updating users:
    // - Users can update their own global profile.
    // - Platform admins can update user accounts (e.g. status changes).
    pgPolicy('users_update', {
      for: 'update',
      to: 'fortis_app',
      using: sql`
        id = app.current_user_id() OR app.is_platform_user()
      `,
      withCheck: sql`
        id = app.current_user_id() OR app.is_platform_user()
      `,
    }),
  ],
).enableRLS();
