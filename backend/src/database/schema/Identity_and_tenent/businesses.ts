import {
    pgTable,
    uuid,
    text,
    boolean,
    timestamp,
    pgPolicy,
    uniqueIndex,
    check
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { platformUsers } from "./platform_users";

export const business = pgTable('business', {
    id: uuid('id').defaultRandom().primaryKey(),
    legalName: text('legal_name').notNull(),
    displayName: text('display_name').notNull(),
    pan: text('pan').notNull(),
    address: text('address'),
    primaryContactNumber: text('primary_contact_number'),
    primaryContactEmail: text('primary_contact_email'),
    isActive: boolean('is_active').notNull().default(false),
    createdBy: uuid('created_by').notNull().references(() => platformUsers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
},
(table) => [
    // Unique index on PAN number to prevent duplicate business registrations
    uniqueIndex('business_pan_uq').on(table.pan),

    // Check constraint to ensure PAN is not empty
    check('business_pan_chk', sql`btrim(pan) <> ''`),

    // RLS Policy: Only the business owner of the active session or platform admins can view business details
    pgPolicy('business_select', {
        for: 'select',
        to: 'fortis_app',
        using: sql`
            (id = app_business_id() AND app_is_owner() = true)
            OR app_is_platform() = true
        `
    }),

    // RLS Policy: Only the business owner or platform admins can update business info
    pgPolicy('business_update', {
        for: 'update',
        to: 'fortis_app',
        using: sql`
            (id = app_business_id() AND app_is_owner() = true)
            OR app_is_platform() = true
        `,
        withCheck: sql`
            (id = app_business_id() AND app_is_owner() = true)
            OR app_is_platform() = true
        `
    }),

    // RLS Policy: Only platform managers can insert/create new businesses
    pgPolicy('business_insert', {
        for: 'insert',
        to: 'fortis_app',
        withCheck: sql`
            app_is_platform() = true
        `
    })
]).enableRLS();