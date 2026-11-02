import {
    pgTable,
    uuid,
    text,
    primaryKey,
    uniqueIndex,
    index,
    pgPolicy,
    timestamp
} from "drizzle-orm/pg-core"
import { relations, sql } from "drizzle-orm"
import {branches} from "./branches"
import {terminals} from "./terminals"
import {businessMemberships as memberships} from "./businessMembership"
import {roles} from "./roles"
import {invitations} from "./invitations"



// Business Table (Root tenent table)

export const businesses = pgTable("businesses", {
    id: uuid("id").defaultRandom().primaryKey(),
    legalName: text("legal_name").notNull(),
    displayName: text('display_name').notNull(),
    pan: text('pan'),
    taxProfileRef: text('tax_profile_ref'),
    ownerSetupStatus: text('owner_setup_status').default('pending').notNull(),
    status: text('status').default('active').notNull(),
    contactEmail: text('contact_email'),
    address: text('address'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index("index_business_status").on(table.status),
    pgPolicy("tenant_business_isolation_policy", {
        for: "all",
        to: "public",
        using: sql`current_setting('app.is_platform_support', true) = 'true' OR id = current_setting('app.current_business_id', true)::uuid`,
        withCheck: sql`current_setting('app.is_platform_support', true) = 'true' OR id = current_setting('app.current_business_id', true)::uuid`,
    })
]).enableRLS()



export const businessRelations = relations(businesses, ({many}) => ({
    branches: many(branches),
    terminals: many(terminals),
    memberships: many(memberships),
    roles: many(roles),
    invitations: many(invitations),
}))