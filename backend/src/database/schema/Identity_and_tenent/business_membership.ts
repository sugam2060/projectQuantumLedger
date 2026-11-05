import {
    pgTable,
    uuid,
    boolean,
    timestamp,
    pgPolicy,
    uniqueIndex,
    check
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { business } from "./businesses";
import { branches } from "./branches";
import { roles } from "./roles";
import { users } from "./users";

export const businessMemberships = pgTable('business_memberships', {
    id: uuid('id').defaultRandom().primaryKey(),
    businessId: uuid('business_id').notNull().references(() => business.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    roleId: uuid('role_id').notNull().references(() => roles.id),
    isOwner: boolean('is_owner').notNull().default(false),
    branchId: uuid('branch_id').references(() => branches.id), // NULL = access to all branches in the business
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
},
(table) => [
    // Unique index: A user should only have one membership record per business
    uniqueIndex('business_memberships_user_business_uq').on(table.userId, table.businessId),

    // RLS Policy: Users can view memberships within their business session, or platform admins can view all
    pgPolicy('business_memberships_select', {
        for: 'select',
        to: 'fortis_app',
        using: sql`
            business_id = app_business_id()
            OR user_id = app_user_id()
            OR app_is_platform() = true
        `
    }),

    // RLS Policy: Insertions are managed via SECURITY DEFINER functions (like invitation redemption) or platform admins
    pgPolicy('business_memberships_insert', {
        for: 'insert',
        to: 'fortis_app',
        withCheck: sql`
            business_id = app_business_id()
            OR app_is_platform() = true
        `
    }),

    // RLS Policy: Updates for memberships within the active business or platform admins
    pgPolicy('business_memberships_update', {
        for: 'update',
        to: 'fortis_app',
        using: sql`
            business_id = app_business_id()
            OR app_is_platform() = true
        `,
        withCheck: sql`
            business_id = app_business_id()
            OR app_is_platform() = true
        `
    })
]).enableRLS();