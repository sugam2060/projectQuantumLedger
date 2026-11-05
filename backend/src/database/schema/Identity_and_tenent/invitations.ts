import {
    pgTable,
    uuid,
    text,
    pgPolicy,
    timestamp,
    uniqueIndex,
    check
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { business } from "./businesses";
import { branches } from "./branches";
import { roles } from "./roles";
import { users } from "./users";
import { platformUsers } from "./platform_users";

export const invitations = pgTable('invitations', {
    id: uuid('id').defaultRandom().primaryKey(),
    businessId: uuid('business_id').notNull().references(() => business.id),
    emailNormalized: text('email_normalized').notNull(),
    roleId: uuid('role_id').notNull().references(() => roles.id),
    branchId: uuid('branch_id').references(() => branches.id), // NULL = business-wide invite
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id),
    invitedByPlatformUserId: uuid('invited_by_platform_user_id').references(() => platformUsers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
},
(table) => [
    // Unique token hash constraint
    uniqueIndex('invitations_token_hash_uq').on(table.tokenHash),

    // Unique index: One open invitation per business + email
    uniqueIndex('invitations_one_open_per_email_uq')
        .on(table.businessId, table.emailNormalized)
        .where(sql`consumed_at IS NULL AND revoked_at IS NULL`),

    // Check constraints
    check('invitations_email_chk', sql`email_normalized = lower(btrim(email_normalized))`),
    check('invitations_inviter_chk', sql`num_nonnulls(invited_by_user_id, invited_by_platform_user_id) = 1`),
    check('invitations_state_chk', sql`consumed_at IS NULL OR revoked_at IS NULL`),

    // 1. SELECT Policy: Platform admins view all; owners view their business; branch managers view only their branch or business-wide
    pgPolicy('invitations_select', {
        for: 'select',
        to: 'fortis_app',
        using: sql`
            app_is_platform() = true
            OR (business_id = app_business_id() AND app_is_owner() = true)
            OR (business_id = app_business_id() AND (app_branch_id() IS NULL OR branch_id = app_branch_id()))
        `
    }),

    // 2. INSERT Policy: Platform admins can insert anywhere; owners can insert anywhere in their business; branch managers only for their specific branch
    pgPolicy('invitations_insert', {
        for: 'insert',
        to: 'fortis_app',
        withCheck: sql`
            app_is_platform() = true
            OR (business_id = app_business_id() AND app_is_owner() = true)
            OR (business_id = app_business_id() AND app_branch_id() IS NOT NULL AND branch_id = app_branch_id())
        `
    }),

    // 3. UPDATE Policy: Allow modifying/revoking invitations within owner/branch-manager scoping or platform admin
    pgPolicy('invitations_update', {
        for: 'update',
        to: 'fortis_app',
        using: sql`
            app_is_platform() = true
            OR (business_id = app_business_id() AND app_is_owner() = true)
            OR (business_id = app_business_id() AND (app_branch_id() IS NULL OR branch_id = app_branch_id()))
        `,
        withCheck: sql`
            app_is_platform() = true
            OR (business_id = app_business_id() AND app_is_owner() = true)
            OR (business_id = app_business_id() AND (app_branch_id() IS NULL OR branch_id = app_branch_id()))
        `
    }),

    // 4. DELETE Policy: Allow cleanup or deletion matching the same administrative tiers
    pgPolicy('invitations_delete', {
        for: 'delete',
        to: 'fortis_app',
        using: sql`
            app_is_platform() = true
            OR (business_id = app_business_id() AND app_is_owner() = true)
            OR (business_id = app_business_id() AND (app_branch_id() IS NULL OR branch_id = app_branch_id()))
        `
    })
]).enableRLS();