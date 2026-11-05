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

export const platformUsers = pgTable('platform_users', {
    id: uuid('id').defaultRandom().primaryKey(),
    emailNormalized: text('email_normalized').notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    isBootstrap: boolean('is_bootstrap').notNull().default(false), // Identifies the initial bootstrap PM
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
},
(table) => [
    // Unique normalized email index for platform administrators
    uniqueIndex('platform_users_email_uq').on(table.emailNormalized),

    // Check constraints to enforce data hygiene
    check('platform_users_email_chk', sql`email_normalized = lower(btrim(email_normalized))`),
    check('platform_users_status_chk', sql`status IN ('active', 'disabled', 'suspended')`),

    // RLS Policy (SELECT): Platform managers can ONLY read their own data (PM A cannot read PM B)
    pgPolicy('platform_users_select', {
        for: 'select',
        to: 'fortis_app',
        using: sql`
            id = app_platform_user_id()
        `
    }),

    // RLS Policy (INSERT): Only the bootstrap platform manager can create new platform managers
    pgPolicy('platform_users_insert', {
        for: 'insert',
        to: 'fortis_app',
        withCheck: sql`
            app_is_bootstrap_platform() = true
        `
    }),

    // RLS Policy (UPDATE): Users can update their own profile, or bootstrap PM can manage accounts
    pgPolicy('platform_users_update', {
        for: 'update',
        to: 'fortis_app',
        using: sql`
            id = app_platform_user_id() 
            OR app_is_bootstrap_platform() = true
        `,
        withCheck: sql`
            id = app_platform_user_id() 
            OR app_is_bootstrap_platform() = true
        `
    }),

    // RLS Policy (DELETE): Only bootstrap platform managers can delete accounts
    pgPolicy('platform_users_delete', {
        for: 'delete',
        to: 'fortis_app',
        using: sql`
            app_is_bootstrap_platform() = true
        `
    })
]).enableRLS();