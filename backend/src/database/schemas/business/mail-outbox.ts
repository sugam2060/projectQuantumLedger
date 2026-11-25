import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
} from 'drizzle-orm/pg-core';
import type { MailJob } from '../../../workers/mail/mail.types';
import { business } from './businesses';
import { businessProvisioningRequests } from './business-provisioning-requests';

export const mailOutbox = pgTable(
  'mail_outbox',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    businessId: uuid('business_id').references(() => business.id),
    requestId: uuid('request_id').references(
      () => businessProvisioningRequests.id,
    ),
    payload: jsonb('payload').$type<MailJob>().notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('mail_outbox_ready_idx').on(table.status, table.availableAt),
    check(
      'mail_outbox_status_chk',
      sql`status IN ('pending', 'processing', 'sent')`,
    ),
    check('mail_outbox_attempts_chk', sql`attempts >= 0`),
    pgPolicy('mail_outbox_select', {
      for: 'select',
      to: 'fortis_app',
      using: sql`app_is_platform() = true`,
    }),
    pgPolicy('mail_outbox_insert', {
      for: 'insert',
      to: 'fortis_app',
      withCheck: sql`app_is_platform() = true`,
    }),
    pgPolicy('mail_outbox_update', {
      for: 'update',
      to: 'fortis_app',
      using: sql`app_is_platform() = true`,
      withCheck: sql`app_is_platform() = true`,
    }),
  ],
).enableRLS();
