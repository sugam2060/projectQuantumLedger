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
} from 'drizzle-orm/pg-core';
import type { BusinessDocuments } from './businesses';
import { platformUsers } from './platform_users';

export interface BusinessRequestAddress {
  country: string;
  city: string;
  postalCode: string;
  addressLine1: string;
  addressLine2?: string | null;
}

export const businessProvisioningRequests = pgTable(
  'business_provisioning_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    legalName: text('legal_name').notNull(),
    displayName: text('display_name').notNull(),
    documents: jsonb('documents').$type<BusinessDocuments>().notNull(),
    address: jsonb('address').$type<BusinessRequestAddress>().notNull(),
    primaryContactName: text('primary_contact_name').notNull(),
    primaryContactEmail: text('primary_contact_email').notNull(),
    primaryContactPhone: text('primary_contact_phone').notNull(),
    status: text('status').notNull().default('pending'),
    reviewedBy: uuid('reviewed_by').references(() => platformUsers.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNotes: text('review_notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('business_provisioning_requests_status_created_idx').on(
      table.status,
      table.createdAt,
    ),
    index('business_provisioning_requests_contact_email_idx').on(
      table.primaryContactEmail,
    ),
    check(
      'business_provisioning_requests_status_chk',
      sql`status IN ('pending', 'approved', 'rejected')`,
    ),
    check(
      'business_provisioning_requests_legal_name_chk',
      sql`btrim(legal_name) <> ''`,
    ),
    check(
      'business_provisioning_requests_display_name_chk',
      sql`btrim(display_name) <> ''`,
    ),
    pgPolicy('business_provisioning_requests_public_insert', {
      for: 'insert',
      to: 'fortis_app',
      withCheck: sql`true`,
    }),
    pgPolicy('business_provisioning_requests_platform_select', {
      for: 'select',
      to: 'fortis_app',
      using: sql`app_is_platform() = true`,
    }),
    pgPolicy('business_provisioning_requests_platform_update', {
      for: 'update',
      to: 'fortis_app',
      using: sql`app_is_platform() = true`,
      withCheck: sql`app_is_platform() = true`,
    }),
  ],
).enableRLS();
