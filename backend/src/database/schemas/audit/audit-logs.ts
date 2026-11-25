import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgPolicy,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { business } from '../business/businesses';
import { branches } from '../business/branches';
import { users } from '../auth/users';
import { terminals } from '../business/terminals';

// ==========================================
// 2. AUDIT LOGS (Data Mutation & POS Action Tracking)
// ==========================================
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => business.id),
    branchId: uuid('branch_id').references(() => branches.id),
    terminalId: uuid('terminal_id').references(() => terminals.id),
    userId: uuid('user_id').references(() => users.id),
    action: text('action').notNull(), // e.g., 'CREATE_SALE', 'VOID_ITEM', 'UPDATE_INVENTORY', 'PRICE_OVERRIDE'
    tableName: text('table_name').notNull(), // Target table affected
    recordId: uuid('record_id'), // ID of the affected row
    oldValues: jsonb('old_values'), // State before mutation
    newValues: jsonb('new_values'), // State after mutation
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Performance indices for searching audit trails
    index('audit_logs_business_idx').on(table.businessId),
    index('audit_logs_branch_idx').on(table.branchId),
    index('audit_logs_table_record_idx').on(table.tableName, table.recordId),

    // RLS Policy: Tenant isolation matching business/branch context or platform admin override
    pgPolicy('audit_logs_select', {
      for: 'select',
      to: 'fortis_app',
      using: sql`
        app.is_business_owner(business_id) OR app.is_platform_user()
      `,
    }),

    // RLS Policy: Insertions restricted to the active business context or platform admin
    pgPolicy('audit_logs_insert', {
      for: 'insert',
      to: 'fortis_app',
      withCheck: sql`
        app.is_business_member(business_id) OR app.is_platform_user()
      `,
    }),
  ],
).enableRLS();
