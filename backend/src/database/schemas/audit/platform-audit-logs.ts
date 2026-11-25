import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
} from 'drizzle-orm/pg-core';
import { business } from '../business/businesses';
import { businessProvisioningRequests } from '../business/business-provisioning-requests';
import { platformUsers } from '../auth/platform-users';

export const platformAuditLogs = pgTable(
  'platform_audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    platformUserId: uuid('platform_user_id')
      .notNull()
      .references(() => platformUsers.id),
    businessId: uuid('business_id').references(() => business.id),
    requestId: uuid('request_id').references(
      () => businessProvisioningRequests.id,
    ),
    action: text('action').notNull(),
    httpMethod: text('http_method'),
    endpointPath: text('endpoint_path'),
    responseStatus: integer('response_status'),
    correlationId: text('correlation_id'),
    clientType: text('client_type'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata').notNull().default('{}'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('platform_audit_logs_actor_created_idx').on(
      table.platformUserId,
      table.createdAt,
    ),
    index('platform_audit_logs_request_idx').on(table.requestId),
    pgPolicy('platform_audit_logs_select', {
      for: 'select',
      to: 'fortis_app',
      using: sql`
        app.is_platform_user()
      `,
    }),
    pgPolicy('platform_audit_logs_insert', {
      for: 'insert',
      to: 'fortis_app',
      withCheck: sql`
        app.is_platform_user()
      `,
    }),
  ],
).enableRLS();
