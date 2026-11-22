import {
  pgTable,
  uuid,
  boolean,
  timestamp,
  pgPolicy,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { business } from './businesses';
import { branches } from './branches';
import { roles } from './roles';
import { users } from './users';

export const businessMemberships = pgTable(
  'business_memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => business.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    roleId: uuid('role_id').references(() => roles.id),
    isOwner: boolean('is_owner').notNull().default(false),
    branchId: uuid('branch_id').references(() => branches.id), // NULL = access to all branches in the business
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Unique index: A user should only have one membership record per business
    uniqueIndex('business_memberships_user_business_uq').on(
      table.userId,
      table.businessId,
    ),
    uniqueIndex('business_memberships_one_active_user_uq')
      .on(table.userId)
      .where(sql`is_active = true`),
    index('business_memberships_business_branch_active_idx').on(
      table.businessId,
      table.branchId,
      table.isActive,
    ),
    check(
      'business_memberships_role_required_chk',
      sql`is_owner = true OR role_id IS NOT NULL`,
    ),

    // RLS Policy: Users can view memberships within their business session, or platform admins can view all
    pgPolicy('business_memberships_select', {
      for: 'select',
      to: 'fortis_app',
      using: sql`
            business_id = app_business_id()
            OR user_id = app_user_id()
            OR app_is_platform() = true
        `,
    }),

    // RLS Policy: Insertions are managed via SECURITY DEFINER functions (like invitation redemption) or platform admins
    pgPolicy('business_memberships_insert', {
      for: 'insert',
      to: 'fortis_app',
      withCheck: sql`
            (business_id = app_business_id() AND app_is_owner() = true)
            OR app_is_platform() = true
            OR (
              is_owner = true
              AND role_id IS NULL
              AND branch_id IS NULL
              AND user_id = app_user_id()
              AND business_id = app_business_id()
              AND EXISTS (
                SELECT 1
                FROM owner_redemptions r
                WHERE r.business_id = business_memberships.business_id
                  AND r.email_normalized = NULLIF(current_setting('app.registration_email', true), '')
                  AND r.token_hash = NULLIF(current_setting('app.owner_redemption_hash', true), '')
                  AND r.consumed_at IS NULL
                  AND r.revoked_at IS NULL
                  AND r.expires_at > now()
              )
            )
        `,
    }),

    // RLS Policy: Updates for memberships within the active business or platform admins
    pgPolicy('business_memberships_update', {
      for: 'update',
      to: 'fortis_app',
      using: sql`
            business_id = app_business_id()
            OR app_is_platform() = true
        `,
      withCheck: sql`
            business_id = app_business_id()
            OR app_is_platform() = true
        `,
    }),
  ],
).enableRLS();
