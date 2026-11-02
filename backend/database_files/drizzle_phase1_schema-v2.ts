import { 
  pgTable, 
  uuid, 
  text, 
  timestamp, 
  primaryKey, 
  uniqueIndex, 
  index, 
  pgPolicy 
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

/**
 * ==============================================================================
 * FORTIS POS - DRIZZLE ORM SCHEMA (PHASE 1: IDENTITY & MULTI-TENANCY - V2)
 * ==============================================================================
 * This schema maps the 12 core tables for Phase 1: Tenant Isolation, User Identity,
 * Branch/Terminal Registration, RBAC Roles/Permissions, and Access Audit Logging.
 * 
 * Row-Level Security (RLS) is explicitly enabled on tenant tables using Drizzle's
 * `.enableRLS()` builder method alongside `pgPolicy()` definitions.
 * 
 * PostgreSQL Session Context Variables:
 * - app.current_business_id
 * - app.current_branch_id
 * ==============================================================================
 */

// ------------------------------------------------------------------------------
// 1. BUSINESSES (Root Tenant Table)
// ------------------------------------------------------------------------------
export const businesses = pgTable('businesses', {
  id: uuid('id').defaultRandom().primaryKey(),
  legalName: text('legal_name').notNull(),
  displayName: text('display_name').notNull(),
  pan: text('pan'),
  taxProfileRef: text('tax_profile_ref'),
  ownerSetupStatus: text('owner_setup_status').default('pending').notNull(),
  status: text('status').default('active').notNull(),
  contactEmail: text('contact_email'),
  address: text('address'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('idx_businesses_status').on(t.status),
  pgPolicy('tenant_business_isolation_policy', {
    for: 'all',
    to: 'public',
    using: sql`id = current_setting('app.current_business_id', true)::uuid`,
    withCheck: sql`id = current_setting('app.current_business_id', true)::uuid`,
  }),
]).enableRLS();

export const businessesRelations = relations(businesses, ({ many }) => ({
  branches: many(branches),
  terminals: many(terminals),
  memberships: many(businessMemberships),
  roles: many(roles),
  invitations: many(invitations),
}));

// ------------------------------------------------------------------------------
// 2. BRANCHES
// ------------------------------------------------------------------------------
export const branches = pgTable('branches', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  branchCode: text('branch_code').notNull(),
  name: text('name').notNull(),
  address: text('address'),
  timezone: text('timezone').default('Asia/Kathmandu').notNull(),
  status: text('status').default('active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('idx_branches_bus_code').on(t.businessId, t.branchCode),
  pgPolicy('tenant_branch_isolation_policy', {
    for: 'all',
    to: 'public',
    using: sql`business_id = current_setting('app.current_business_id', true)::uuid`,
    withCheck: sql`business_id = current_setting('app.current_business_id', true)::uuid`,
  }),
]).enableRLS();

export const branchesRelations = relations(branches, ({ one, many }) => ({
  business: one(businesses, {
    fields: [branches.businessId],
    references: [businesses.id],
  }),
  terminals: many(terminals),
  branchAssignments: many(branchAssignments),
}));

// ------------------------------------------------------------------------------
// 3. TERMINALS
// ------------------------------------------------------------------------------
export const terminals = pgTable('terminals', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'cascade' }),
  terminalCode: text('terminal_code').notNull(),
  deviceFingerprint: text('device_fingerprint'),
  appVersion: text('app_version'),
  status: text('status').default('active').notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('idx_terminals_bus_code').on(t.businessId, t.terminalCode),
  pgPolicy('tenant_terminal_isolation_policy', {
    for: 'all',
    to: 'public',
    using: sql`business_id = current_setting('app.current_business_id', true)::uuid AND branch_id = current_setting('app.current_branch_id', true)::uuid`,
    withCheck: sql`business_id = current_setting('app.current_business_id', true)::uuid AND branch_id = current_setting('app.current_branch_id', true)::uuid`,
  }),
]).enableRLS();

export const terminalsRelations = relations(terminals, ({ one }) => ({
  business: one(businesses, {
    fields: [terminals.businessId],
    references: [businesses.id],
  }),
  branch: one(branches, {
    fields: [terminals.branchId],
    references: [branches.id],
  }),
}));

// ------------------------------------------------------------------------------
// 4. USERS (Global Identity Table)
// ------------------------------------------------------------------------------
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  displayName: text('display_name').notNull(),
  status: text('status').default('active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(businessMemberships),
  createdRoles: many(roles),
}));

// ------------------------------------------------------------------------------
// 5. BUSINESS MEMBERSHIPS
// ------------------------------------------------------------------------------
export const businessMemberships = pgTable('business_memberships', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').default('active').notNull(),
  invitedBy: uuid('invited_by').references(() => users.id),
  joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('idx_memberships_bus_user').on(t.businessId, t.userId),
  pgPolicy('tenant_membership_isolation_policy', {
    for: 'all',
    to: 'public',
    using: sql`business_id = current_setting('app.current_business_id', true)::uuid`,
    withCheck: sql`business_id = current_setting('app.current_business_id', true)::uuid`,
  }),
]).enableRLS();

export const businessMembershipsRelations = relations(businessMemberships, ({ one, many }) => ({
  business: one(businesses, {
    fields: [businessMemberships.businessId],
    references: [businesses.id],
  }),
  user: one(users, {
    fields: [businessMemberships.userId],
    references: [users.id],
  }),
  branchAssignments: many(branchAssignments),
  assignedRoles: many(membershipRoles),
}));

// ------------------------------------------------------------------------------
// 6. BRANCH ASSIGNMENTS
// ------------------------------------------------------------------------------
export const branchAssignments = pgTable('branch_assignments', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessMembershipId: uuid('business_membership_id').notNull().references(() => businessMemberships.id, { onDelete: 'cascade' }),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'cascade' }),
  status: text('status').default('active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('idx_branch_assignments_unique').on(t.businessMembershipId, t.branchId),
  pgPolicy('tenant_branch_assignment_isolation_policy', {
    for: 'all',
    to: 'public',
    using: sql`business_id = current_setting('app.current_business_id', true)::uuid`,
    withCheck: sql`business_id = current_setting('app.current_business_id', true)::uuid`,
  }),
]).enableRLS();

export const branchAssignmentsRelations = relations(branchAssignments, ({ one }) => ({
  membership: one(businessMemberships, {
    fields: [branchAssignments.businessMembershipId],
    references: [businessMemberships.id],
  }),
  business: one(businesses, {
    fields: [branchAssignments.businessId],
    references: [businesses.id],
  }),
  branch: one(branches, {
    fields: [branchAssignments.branchId],
    references: [branches.id],
  }),
}));

// ------------------------------------------------------------------------------
// 7. ROLES
// ------------------------------------------------------------------------------
export const roles = pgTable('roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  roleCode: text('role_code').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  scopeMode: text('scope_mode').default('branch').notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('idx_roles_bus_code').on(t.businessId, t.roleCode),
  pgPolicy('tenant_role_isolation_policy', {
    for: 'all',
    to: 'public',
    using: sql`business_id = current_setting('app.current_business_id', true)::uuid`,
    withCheck: sql`business_id = current_setting('app.current_business_id', true)::uuid`,
  }),
]).enableRLS();

export const rolesRelations = relations(roles, ({ one, many }) => ({
  business: one(businesses, {
    fields: [roles.businessId],
    references: [businesses.id],
  }),
  permissions: many(rolePermissions),
  memberAssignments: many(membershipRoles),
}));

// ------------------------------------------------------------------------------
// 8. PERMISSIONS (Global Catalog Reference Table)
// ------------------------------------------------------------------------------
export const permissions = pgTable('permissions', {
  permissionCode: text('permission_code').primaryKey(),
  method: text('method'),
  routePattern: text('route_pattern'),
  description: text('description'),
  module: text('module').notNull(),
  riskLevel: text('risk_level').default('normal').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const permissionsRelations = relations(permissions, ({ many }) => ({
  roles: many(rolePermissions),
}));

// ------------------------------------------------------------------------------
// 9. ROLE PERMISSIONS
// ------------------------------------------------------------------------------
export const rolePermissions = pgTable('role_permissions', {
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permissionCode: text('permission_code').notNull().references(() => permissions.permissionCode, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.roleId, t.permissionCode] }),
]);

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, {
    fields: [rolePermissions.roleId],
    references: [roles.id],
  }),
  permission: one(permissions, {
    fields: [rolePermissions.permissionCode],
    references: [permissions.permissionCode],
  }),
}));

// ------------------------------------------------------------------------------
// 10. MEMBERSHIP ROLES
// ------------------------------------------------------------------------------
export const membershipRoles = pgTable('membership_roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessMembershipId: uuid('business_membership_id').notNull().references(() => businessMemberships.id, { onDelete: 'cascade' }),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  pgPolicy('tenant_membership_role_isolation_policy', {
    for: 'all',
    to: 'public',
    using: sql`business_id = current_setting('app.current_business_id', true)::uuid`,
    withCheck: sql`business_id = current_setting('app.current_business_id', true)::uuid`,
  }),
]).enableRLS();

export const membershipRolesRelations = relations(membershipRoles, ({ one }) => ({
  membership: one(businessMemberships, {
    fields: [membershipRoles.businessMembershipId],
    references: [businessMemberships.id],
  }),
  role: one(roles, {
    fields: [membershipRoles.roleId],
    references: [roles.id],
  }),
  branch: one(branches, {
    fields: [membershipRoles.branchId],
    references: [branches.id],
  }),
}));

// ------------------------------------------------------------------------------
// 11. INVITATIONS
// ------------------------------------------------------------------------------
export const invitations = pgTable('invitations', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  status: text('status').default('pending').notNull(),
  expiry: timestamp('expiry', { withTimezone: true }).notNull(),
  invitedBy: uuid('invited_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('idx_invitations_token_hash').on(t.tokenHash),
  pgPolicy('tenant_invitation_isolation_policy', {
    for: 'all',
    to: 'public',
    using: sql`business_id = current_setting('app.current_business_id', true)::uuid`,
    withCheck: sql`business_id = current_setting('app.current_business_id', true)::uuid`,
  }),
]).enableRLS();

export const invitationsRelations = relations(invitations, ({ one }) => ({
  business: one(businesses, {
    fields: [invitations.businessId],
    references: [businesses.id],
  }),
  role: one(roles, {
    fields: [invitations.roleId],
    references: [roles.id],
  }),
  branch: one(branches, {
    fields: [invitations.branchId],
    references: [branches.id],
  }),
  inviter: one(users, {
    fields: [invitations.invitedBy],
    references: [users.id],
  }),
}));

// ------------------------------------------------------------------------------
// 12. ACCESS AUDIT EVENTS
// ------------------------------------------------------------------------------
export const accessAuditEvents = pgTable('access_audit_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'set null' }),
  branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  targetUserId: uuid('target_user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  reason: text('reason'),
  requestId: text('request_id'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('idx_access_audit_bus_time').on(t.businessId, t.occurredAt),
  pgPolicy('tenant_access_audit_isolation_policy', {
    for: 'select',
    to: 'public',
    using: sql`business_id IS NULL OR business_id = current_setting('app.current_business_id', true)::uuid`,
  }),
]).enableRLS();

export const accessAuditEventsRelations = relations(accessAuditEvents, ({ one }) => ({
  business: one(businesses, {
    fields: [accessAuditEvents.businessId],
    references: [businesses.id],
  }),
  branch: one(branches, {
    fields: [accessAuditEvents.branchId],
    references: [branches.id],
  }),
  actor: one(users, {
    fields: [accessAuditEvents.actorUserId],
    references: [users.id],
  }),
  targetUser: one(users, {
    fields: [accessAuditEvents.targetUserId],
    references: [users.id],
  }),
}));
