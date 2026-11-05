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

export const users = pgTable('users', {
    id: uuid('id').defaultRandom().primaryKey(),
    emailNormalized: text('email_normalized').notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
},
(table) => [
    // Unique index on normalized global email
    uniqueIndex('users_email_uq').on(table.emailNormalized),

    // Check constraints to enforce data hygiene
    check('users_email_chk', sql`email_normalized = lower(btrim(email_normalized))`),
    check('users_status_chk', sql`status IN ('active', 'disabled')`),

    // RLS Policy for user registration via valid invitation redemption
    pgPolicy('users_insert', {
        for: 'insert',
        to: 'fortis_app',
        withCheck: sql`
            EXISTS (
                SELECT 1 FROM invitations 
                WHERE email_normalized = ${table.emailNormalized}
                AND consumed_at IS NULL
                AND revoked_at IS NULL
            )
            OR public.app_is_platform() = true
        `
    }),

    // RLS Policy for viewing users:
    // - A user can always view their own global profile.
    // - Coworkers within the same active business session can see each other via business_memberships.
    // - Platform admins have global visibility.
    pgPolicy('users_select', {
        for: 'select',
        to: 'fortis_app',
        using: sql`
            id = public.app_user_id()
            OR EXISTS (
                SELECT 1 FROM business_memberships m1
                JOIN business_memberships m2 ON m1.business_id = m2.business_id
                WHERE m1.user_id = public.app_user_id() 
                  AND m2.user_id = users.id 
                  AND m1.business_id = public.app_business_id()
                  AND m1.is_active = true
                  AND m2.is_active = true
            )
            OR public.app_is_platform() = true
        `
    }),

    // RLS Policy for updating users:
    // - Users can update their own global profile.
    // - Platform admins can update user accounts (e.g. status changes).
    pgPolicy('users_update', {
        for: 'update',
        to: 'fortis_app',
        using: sql`
            id = public.app_user_id()
            OR public.app_is_platform() = true
        `,
        withCheck: sql`
            id = public.app_user_id()
            OR public.app_is_platform() = true
        `
    })
]).enableRLS();