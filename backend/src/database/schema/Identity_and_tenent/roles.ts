import {
    pgTable,
    uuid,
    text,
    boolean,
    timestamp,
    pgPolicy,
    uniqueIndex,
    check,
    jsonb
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { business } from "./businesses";

export const roles = pgTable('roles', {
    id: uuid('id').defaultRandom().primaryKey(),
    businessId: uuid('business_id').references(() => business.id), // NULL = Global/System Role, NOT NULL = Business-wide Tenant Role
    name: text('name').notNull(),
    description: text('description'),
    permissions: jsonb('permissions').notNull().default('[]'), // Stores list of permitted actions/endpoints
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
},
(table) => [
    // Unique role name per business (or globally if system-wide)
    uniqueIndex('roles_business_name_uq').on(table.businessId, table.name),

    // Check constraint to ensure role name is not empty
    check('roles_name_chk', sql`btrim(name) <> ''`),

    // RLS Policy: Users can view roles belonging to their business session, global system roles, or platform admins can view all
    pgPolicy('roles_select', {
        for: 'select',
        to: 'fortis_app',
        using: sql`
            business_id = app_business_id()
            OR business_id IS NULL
            OR app_is_platform() = true
        `
    }),

    // RLS Policy: Business-wide roles can be inserted by the business owner or branch managers
    pgPolicy('roles_insert', {
        for: 'insert',
        to: 'fortis_app',
        withCheck: sql`
            (business_id = app_business_id() AND (app_is_owner() = true OR app_branch_id() IS NOT NULL))
            OR app_is_platform() = true
        `
    }),

    // RLS Policy: Allow updates for business-wide roles by owners, managers, or platform admins
    pgPolicy('roles_update', {
        for: 'update',
        to: 'fortis_app',
        using: sql`
            (business_id = app_business_id() AND (app_is_owner() = true OR app_branch_id() IS NOT NULL))
            OR app_is_platform() = true
        `,
        withCheck: sql`
            (business_id = app_business_id() AND (app_is_owner() = true OR app_branch_id() IS NOT NULL))
            OR app_is_platform() = true
        `
    })
]).enableRLS();