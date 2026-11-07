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
import { business } from '../Identity_and_tenent/businesses';
import { branches } from '../Identity_and_tenent/branches';
import { users } from '../Identity_and_tenent/users';
import { terminals } from '../Identity_and_tenent/terminals';

// ==========================================
// 1. ACCESS LOGS (Authentication & Session Tracking)
// ==========================================
export const accessLogs = pgTable(
  'access_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    businessId: uuid('business_id').references(() => business.id), // Nullable for platform logins
    userId: uuid('user_id').references(() => users.id),
    eventType: text('event_type').notNull(), // e.g., 'LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'TOKEN_REFRESH'
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata').notNull().default('{}'), // Additional contextual data
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Performance indices for searching logs by user or business
    index('access_logs_business_idx').on(table.businessId),
    index('access_logs_user_idx').on(table.userId),

    // RLS Policy: Users view access logs for their business; platform admins view all
    pgPolicy('access_logs_select', {
      for: 'select',
      to: 'fortis_app',
      using: sql`
            business_id = app_business_id()
            OR user_id = app_user_id()
            OR app_is_platform() = true
        `,
    }),

    // RLS Policy: Allow insertion from application runtime or security definer flows
    pgPolicy('access_logs_insert', {
      for: 'insert',
      to: 'fortis_app',
      withCheck: sql`
            business_id = app_business_id()
            OR business_id IS NULL
            OR app_is_platform() = true
        `,
    }),
  ],
).enableRLS();

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
            business_id = app_business_id()
            AND (app_branch_id() IS NULL OR branch_id = app_branch_id())
            OR app_is_platform() = true
        `,
    }),

    // RLS Policy: Insertions restricted to the active business context or platform admin
    pgPolicy('audit_logs_insert', {
      for: 'insert',
      to: 'fortis_app',
      withCheck: sql`
            business_id = app_business_id()
            OR app_is_platform() = true
        `,
    }),
  ],
).enableRLS();
