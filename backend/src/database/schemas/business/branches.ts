import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  pgPolicy,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { business } from './businesses';

export const branches = pgTable(
  'branches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => business.id),
    name: text('name').notNull(),
    code: text('code').notNull(), // Short code for the branch, e.g., 'KTM-01'
    address: text('address'),
    contactNumber: text('contact_number'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Unique branch code per business to prevent duplicates
    uniqueIndex('branches_business_code_uq').on(table.businessId, table.code),
    index('branches_business_created_id_idx').on(
      table.businessId,
      table.createdAt,
      table.id,
    ),

    // Check constraint to ensure branch code isn't empty
    check('branches_code_chk', sql`btrim(code) <> ''`),

    // RLS Policy: Users can view branches belonging to their current business session, or platform admins can view all
    pgPolicy('branches_select', {
      for: 'select',
      to: 'fortis_app',
      using: sql`
        app.can_access_branch(business_id, id) OR app.is_platform_user()
      `,
    }),

    // RLS Policy: ONLY platform admins can insert/create new branches
    pgPolicy('branches_insert', {
      for: 'insert',
      to: 'fortis_app',
      withCheck: sql`
        app.is_platform_user()
      `,
    }),

    // RLS Policy: Allow updates for branches belonging to the active business owner or platform admins
    pgPolicy('branches_update', {
      for: 'update',
      to: 'fortis_app',
      using: sql`
        app.is_business_owner(business_id) OR app.is_platform_user()
      `,
      withCheck: sql`
        app.is_business_owner(business_id) OR app.is_platform_user()
      `,
    }),
  ],
).enableRLS();
