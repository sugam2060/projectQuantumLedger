import { relations, sql } from 'drizzle-orm';
import {
  index,
  pgPolicy,
  pgTable,
  check,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { business } from './businesses';
import { roles } from './roles';

export const endpointRoleAccess = pgTable(
  'endpoint_role_access',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => business.id, { onDelete: 'cascade' }),
    endpointKey: text('endpoint_key').notNull(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
  },
  (table) => [
    check(
      'endpoint_role_access_key_chk',
      sql`endpoint_key ~ '^[a-z][a-z0-9_.:-]{1,119}$'`,
    ),
    uniqueIndex('endpoint_role_access_business_endpoint_role_uq').on(
      table.businessId,
      table.endpointKey,
      table.roleId,
    ),
    index('endpoint_role_access_endpoint_idx').on(
      table.businessId,
      table.endpointKey,
    ),
    pgPolicy('endpoint_role_access_select', {
      for: 'select',
      to: 'fortis_app',
      using: sql`
        business_id = app_business_id()
        OR app_is_platform() = true
      `,
    }),
    pgPolicy('endpoint_role_access_insert', {
      for: 'insert',
      to: 'fortis_app',
      withCheck: sql`
        (business_id = app_business_id() AND app_is_owner() = true)
        AND EXISTS (
          SELECT 1
          FROM roles
          WHERE roles.id = endpoint_role_access.role_id
            AND (roles.business_id = endpoint_role_access.business_id OR roles.business_id IS NULL)
        )
        OR app_is_platform() = true
      `,
    }),
    pgPolicy('endpoint_role_access_delete', {
      for: 'delete',
      to: 'fortis_app',
      using: sql`
        (business_id = app_business_id() AND app_is_owner() = true)
        OR app_is_platform() = true
      `,
    }),
  ],
).enableRLS();

export const endpointRoleAccessRelations = relations(
  endpointRoleAccess,
  ({ one }) => ({
    business: one(business, {
      fields: [endpointRoleAccess.businessId],
      references: [business.id],
    }),
    role: one(roles, {
      fields: [endpointRoleAccess.roleId],
      references: [roles.id],
    }),
  }),
);
