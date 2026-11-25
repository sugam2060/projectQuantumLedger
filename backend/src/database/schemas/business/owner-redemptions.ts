import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { business } from './businesses';
import { businessProvisioningRequests } from './business-provisioning-requests';
import { platformUsers } from '../auth/platform-users';
import { users } from '../auth/users';

export const ownerRedemptions = pgTable(
  'owner_redemptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => business.id),
    requestId: uuid('request_id')
      .notNull()
      .references(() => businessProvisioningRequests.id),
    emailNormalized: text('email_normalized').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdByPlatformUserId: uuid('created_by_platform_user_id')
      .notNull()
      .references(() => platformUsers.id),
    consumedByUserId: uuid('consumed_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('owner_redemptions_token_hash_uq').on(table.tokenHash),
    uniqueIndex('owner_redemptions_request_uq').on(table.requestId),
    index('owner_redemptions_business_email_idx').on(
      table.businessId,
      table.emailNormalized,
    ),
    check(
      'owner_redemptions_email_chk',
      sql`email_normalized = lower(btrim(email_normalized))`,
    ),
    check(
      'owner_redemptions_state_chk',
      sql`consumed_at IS NULL OR revoked_at IS NULL`,
    ),
    pgPolicy('owner_redemptions_select', {
      for: 'select',
      to: 'fortis_app',
      using: sql`
        app.is_platform_user() OR token_hash = NULLIF(current_setting('app.owner_redemption_hash', true), '')
      `,
    }),
    pgPolicy('owner_redemptions_insert', {
      for: 'insert',
      to: 'fortis_app',
      withCheck: sql`
        app.is_platform_user()
      `,
    }),
    pgPolicy('owner_redemptions_update', {
      for: 'update',
      to: 'fortis_app',
      using: sql`
        app.is_platform_user() OR token_hash = NULLIF(current_setting('app.owner_redemption_hash', true), '')
      `,
      withCheck: sql`
        app.is_platform_user() OR token_hash = NULLIF(current_setting('app.owner_redemption_hash', true), '')
      `,
    }),
  ],
).enableRLS();
