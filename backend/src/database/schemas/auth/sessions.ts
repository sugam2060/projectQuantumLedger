import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { terminals } from '../business/terminals';
import { platformUsers } from './platform-users';
import { users } from './users';

/**
 * Refresh-token sessions for business users and platform users (exactly one of
 * user_id / platform_user_id is set). Only the SHA-256 of the refresh token is
 * stored. All writes go through SECURITY DEFINER functions
 * (app.auth_create_session / auth_rotate_session / auth_revoke_*), so the runtime
 * role has a read policy for its own rows and no write policies.
 *
 * Rows stay after revocation until the purge job removes them: rotated rows are
 * how reuse of a stolen refresh token is detected.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    platformUserId: uuid('platform_user_id').references(
      () => platformUsers.id,
      { onDelete: 'cascade' },
    ),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    clientType: text('client_type').notNull(),
    terminalId: uuid('terminal_id').references(() => terminals.id, {
      onDelete: 'set null',
    }),
    /** "Remember me": long refresh lifetime and a persistent browser cookie. */
    persistent: boolean('persistent').notNull().default(false),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('sessions_refresh_token_hash_uq').on(table.refreshTokenHash),
    index('sessions_user_active_idx').on(table.userId, table.revokedAt),
    index('sessions_platform_user_active_idx').on(
      table.platformUserId,
      table.revokedAt,
    ),
    index('sessions_expires_at_idx').on(table.expiresAt),
    check(
      'sessions_one_actor_chk',
      sql`num_nonnulls(user_id, platform_user_id) = 1`,
    ),
    check('sessions_hash_chk', sql`refresh_token_hash ~ '^[0-9a-f]{64}$'`),
    pgPolicy('sessions_select_own', {
      for: 'select',
      to: 'fortis_app',
      using: sql`
        (user_id IS NOT NULL AND user_id = app.current_user_id())
        OR (platform_user_id IS NOT NULL
            AND platform_user_id = app.current_platform_user_id())
      `,
    }),
  ],
).enableRLS();
