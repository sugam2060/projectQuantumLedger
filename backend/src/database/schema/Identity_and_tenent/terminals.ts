import {
    pgTable,
    uuid,
    text,
    timestamp,
    pgPolicy,
    uniqueIndex,
    check
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { business } from "./businesses";
import { branches } from "./branches";

export const terminals = pgTable('terminals', {
    id: uuid('id').defaultRandom().primaryKey(),
    businessId: uuid('business_id').notNull().references(() => business.id),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    name: text('name').notNull(), // e.g., 'Checkout Counter 1'
    terminalCode: text('terminal_code').notNull(), // e.g., 'REG-01'
    status: text('status').notNull().default('active'), // 'active', 'inactive', 'maintenance'
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
},
(table) => [
    // Unique terminal code per branch
    uniqueIndex('terminals_branch_code_uq').on(table.branchId, table.terminalCode),

    // Check constraints for hygiene
    check('terminals_name_chk', sql`btrim(name) <> ''`),
    check('terminals_status_chk', sql`status IN ('active', 'inactive', 'maintenance')`),

    // RLS Policy: Users view branch-specific terminals matching their business session, or platform admins view all
    pgPolicy('terminals_select', {
        for: 'select',
        to: 'fortis_app',
        using: sql`
            (business_id = app_business_id() AND (app_branch_id() IS NULL OR branch_id = app_branch_id()))
            OR app_is_platform() = true
        `
    }),

    // RLS Policy: ONLY platform managers can create terminals
    pgPolicy('terminals_insert', {
        for: 'insert',
        to: 'fortis_app',
        withCheck: sql`
            app_is_platform() = true
        `
    }),

    // RLS Policy: ONLY platform managers can update terminals
    pgPolicy('terminals_update', {
        for: 'update',
        to: 'fortis_app',
        using: sql`
            app_is_platform() = true
        `,
        withCheck: sql`
            app_is_platform() = true
        `
    })
]).enableRLS();