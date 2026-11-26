import { sql } from 'drizzle-orm';
import { check, pgPolicy, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Catalogue of business permission codes, seeded by
 * script/sql/04-seed-authorization.sql and kept equal to the `Permission`
 * constant (a db spec checks this). Read-only for the runtime role: SELECT
 * policy only, and INSERT/UPDATE/DELETE are revoked in 03.
 */
export const permissions = pgTable(
  'permissions',
  {
    key: text('key').primaryKey(),
    description: text('description').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  () => [
    check('permissions_key_chk', sql`key ~ '^[a-z]+(:[a-z_]+)+$'`),
    pgPolicy('permissions_select', {
      for: 'select',
      to: 'fortis_app',
      using: sql`true`,
    }),
  ],
).enableRLS();
