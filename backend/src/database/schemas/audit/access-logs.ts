import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgPolicy,
  jsonb,
  index,
  integer,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { business } from '../business/businesses';
import { users } from '../auth/users';
import { terminals } from '../business/terminals';

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
    httpMethod: text('http_method'),
    endpointPath: text('endpoint_path'),
    responseStatus: integer('response_status'),
    requestId: text('request_id'),
    clientType: text('client_type'),
    terminalId: uuid('terminal_id').references(() => terminals.id),
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
        user_id = app.current_user_id()
        OR (business_id IS NOT NULL AND app.has_permission(business_id, NULL, 'audit:read'))
        OR app.is_platform_user()
      `,
    }),

    // RLS Policy: Allow insertion from application runtime or security definer flows
    pgPolicy('access_logs_insert', {
      for: 'insert',
      to: 'fortis_app',
      withCheck: sql`
        business_id IS NULL OR app.is_business_member(business_id) OR app.is_platform_user()
      `,
    }),
  ],
).enableRLS();
