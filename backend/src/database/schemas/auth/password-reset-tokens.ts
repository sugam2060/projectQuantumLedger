import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { platformUsers } from './platform-users';
import { users } from './users';

/**
 * Single-use password reset tokens for business users or platform users (exactly
 * one actor). Only the SHA-256 of the emailed token is stored. RLS is enabled with
 * no policies: the runtime role reaches this table only through
 * app.auth_create_reset_token / app.auth_consume_reset_token.
 */
export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    platformUserId: uuid('platform_user_id').references(
      () => platformUsers.id,
      { onDelete: 'cascade' },
    ),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('password_reset_tokens_hash_uq').on(table.tokenHash),
    index('password_reset_tokens_expires_at_idx').on(table.expiresAt),
    check(
      'password_reset_tokens_one_actor_chk',
      sql`num_nonnulls(user_id, platform_user_id) = 1`,
    ),
    check('password_reset_tokens_hash_chk', sql`token_hash ~ '^[0-9a-f]{64}$'`),
  ],
).enableRLS();
