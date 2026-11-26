import { sql } from 'drizzle-orm';
import {
  check,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from '../auth/users';
import { business } from './businesses';
import { permissions } from './permissions';

/**
 * Per-member exceptions to the role: `allow` grants a permission the role lacks,
 * `deny` removes one it has. Deny wins (see app.has_permission).
 */
export const memberPermissionOverrides = pgTable(
  'member_permission_overrides',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => business.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    permissionKey: text('permission_key')
      .notNull()
      .references(() => permissions.key, { onDelete: 'cascade' }),
    effect: text('effect').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('member_permission_overrides_member_key_uq').on(
      table.businessId,
      table.userId,
      table.permissionKey,
    ),
    check(
      'member_permission_overrides_effect_chk',
      sql`effect IN ('allow', 'deny')`,
    ),
    pgPolicy('member_permission_overrides_select', {
      for: 'select',
      to: 'fortis_app',
      using: sql`
        user_id = app.current_user_id()
        OR app.has_permission(business_id, NULL, 'member:read')
        OR app.is_platform_user()
      `,
    }),
    pgPolicy('member_permission_overrides_insert', {
      for: 'insert',
      to: 'fortis_app',
      withCheck: sql`app.has_permission(business_id, NULL, 'override:manage')`,
    }),
    pgPolicy('member_permission_overrides_update', {
      for: 'update',
      to: 'fortis_app',
      using: sql`app.has_permission(business_id, NULL, 'override:manage')`,
      withCheck: sql`app.has_permission(business_id, NULL, 'override:manage')`,
    }),
    pgPolicy('member_permission_overrides_delete', {
      for: 'delete',
      to: 'fortis_app',
      using: sql`app.has_permission(business_id, NULL, 'override:manage')`,
    }),
  ],
).enableRLS();
