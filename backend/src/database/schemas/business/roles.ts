import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  pgPolicy,
  uniqueIndex,
  check,
  integer,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { branches } from './branches';
import { business } from './businesses';

/**
 * Role templates. System roles (`business_id IS NULL`, `is_system`) are seeded and
 * read-only; custom roles belong to one business and, with `branch_id`, can be
 * limited to one branch. A role's permissions live in `role_permissions`.
 */
export const roles = pgTable(
  'roles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    businessId: uuid('business_id').references(() => business.id), // NULL = system role
    /** Branch-level role: usable only by members of this branch. */
    branchId: uuid('branch_id').references(() => branches.id),
    /** Stable slug derived from the name (e.g. "release-manager"). */
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    version: integer('version').notNull().default(1),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('roles_business_name_uq').on(table.businessId, table.name),
    uniqueIndex('roles_business_key_uq').on(
      sql`coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid)`,
      table.key,
    ),

    check('roles_name_chk', sql`btrim(name) <> ''`),
    check('roles_version_chk', sql`version > 0`),
    check('roles_key_chk', sql`key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check(
      'roles_system_chk',
      sql`(is_system AND business_id IS NULL AND branch_id IS NULL) OR (NOT is_system AND business_id IS NOT NULL)`,
    ),

    pgPolicy('roles_select', {
      for: 'select',
      to: 'fortis_app',
      using: sql`
        business_id IS NULL OR app.is_business_member(business_id) OR app.is_platform_user()
      `,
    }),
    pgPolicy('roles_insert', {
      for: 'insert',
      to: 'fortis_app',
      withCheck: sql`
        NOT is_system
        AND business_id IS NOT NULL
        AND app.has_permission(business_id, NULL, 'role:create')
      `,
    }),
    pgPolicy('roles_update', {
      for: 'update',
      to: 'fortis_app',
      using: sql`
        NOT is_system AND app.has_permission(business_id, NULL, 'role:update')
      `,
      withCheck: sql`
        NOT is_system AND app.has_permission(business_id, NULL, 'role:update')
      `,
    }),
    pgPolicy('roles_delete', {
      for: 'delete',
      to: 'fortis_app',
      using: sql`
        NOT is_system AND app.has_permission(business_id, NULL, 'role:delete')
      `,
    }),
  ],
).enableRLS();
