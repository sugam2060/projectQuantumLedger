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
import { business } from './businesses';
import { branches } from './branches';

export const terminals = pgTable(
  'terminals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => business.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    name: text('name').notNull(), // e.g., 'Checkout Counter 1'
    terminalCode: text('terminal_code').notNull(), // e.g., 'REG-01'
    status: text('status').notNull().default('inactive'), // 'active', 'inactive', 'maintenance'
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Unique terminal code per branch
    uniqueIndex('terminals_branch_code_uq').on(
      table.branchId,
      table.terminalCode,
    ),

    // Check constraints for hygiene
    check('terminals_name_chk', sql`btrim(name) <> ''`),
    check(
      'terminals_status_chk',
      sql`status IN ('active', 'inactive', 'maintenance')`,
    ),

    // RLS Policy: Users view branch-specific terminals matching their business session, or platform admins view all
    pgPolicy('terminals_select', {
      for: 'select',
      to: 'fortis_app',
      using: sql`
        app.can_access_branch(business_id, branch_id) OR app.is_platform_user()
      `,
    }),

    // RLS Policy: ONLY platform managers can create terminals
    pgPolicy('terminals_insert', {
      for: 'insert',
      to: 'fortis_app',
      withCheck: sql`
        app.is_platform_user()
      `,
    }),

    // RLS Policy: ONLY platform managers can update terminals
    pgPolicy('terminals_update', {
      for: 'update',
      to: 'fortis_app',
      using: sql`
        app.is_platform_user()
      `,
      withCheck: sql`
        app.is_platform_user()
      `,
    }),

    pgPolicy('terminals_owner_registration_activate', {
      for: 'update',
      to: 'fortis_app',
      using: sql`
        business_id = NULLIF(current_setting('app.terminal_activation_business_id', true), '')::uuid
        AND branch_id = NULLIF(current_setting('app.terminal_activation_branch_id', true), '')::uuid
        AND terminal_code = NULLIF(current_setting('app.terminal_activation_code', true), '')
        AND status = 'inactive'
        AND EXISTS (
          SELECT 1 FROM owner_redemptions r
          WHERE r.business_id = terminals.business_id
            AND r.token_hash = NULLIF(current_setting('app.owner_redemption_hash', true), '')
            AND r.consumed_at IS NULL AND r.revoked_at IS NULL AND r.expires_at > now()
        )
      `,
      withCheck: sql`
        business_id = NULLIF(current_setting('app.terminal_activation_business_id', true), '')::uuid
        AND branch_id = NULLIF(current_setting('app.terminal_activation_branch_id', true), '')::uuid
        AND terminal_code = NULLIF(current_setting('app.terminal_activation_code', true), '')
        AND status = 'active'
      `,
    }),

    pgPolicy('terminals_owner_activate', {
      for: 'update',
      to: 'fortis_app',
      using: sql`
        app.has_permission(business_id, branch_id, 'terminal:activate')
        AND business_id = NULLIF(current_setting('app.terminal_activation_business_id', true), '')::uuid
        AND branch_id = NULLIF(current_setting('app.terminal_activation_branch_id', true), '')::uuid
        AND terminal_code = NULLIF(current_setting('app.terminal_activation_code', true), '')
        AND status = 'inactive'
      `,
      withCheck: sql`
        app.has_permission(business_id, branch_id, 'terminal:activate')
        AND business_id = NULLIF(current_setting('app.terminal_activation_business_id', true), '')::uuid
        AND branch_id = NULLIF(current_setting('app.terminal_activation_branch_id', true), '')::uuid
        AND terminal_code = NULLIF(current_setting('app.terminal_activation_code', true), '')
        AND status = 'active'
      `,
    }),
  ],
).enableRLS();
