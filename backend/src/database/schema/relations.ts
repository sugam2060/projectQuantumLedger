import { relations } from 'drizzle-orm';
import { accessLogs, auditLogs } from './audit_logs/access_audit_logs';
import { branches } from './Identity_and_tenent/branches';
import { business } from './Identity_and_tenent/businesses';
import { businessMemberships } from './Identity_and_tenent/business_membership';
import { endpointRoleAccess } from './Identity_and_tenent/endpoint_role_access';
import { invitations } from './Identity_and_tenent/invitations';
import { platformUsers } from './Identity_and_tenent/platform_users';
import { roles } from './Identity_and_tenent/roles';
import { terminals } from './Identity_and_tenent/terminals';
import { users } from './Identity_and_tenent/users';

export const businessRelations = relations(business, ({ one, many }) => ({
  createdBy: one(platformUsers, {
    fields: [business.createdBy],
    references: [platformUsers.id],
  }),
  branches: many(branches),
  roles: many(roles),
  memberships: many(businessMemberships),
  invitations: many(invitations),
  terminals: many(terminals),
  accessLogs: many(accessLogs),
  auditLogs: many(auditLogs),
  endpointRoleAccess: many(endpointRoleAccess),
}));

export const platformUsersRelations = relations(platformUsers, ({ many }) => ({
  businessesCreated: many(business),
  invitationsSent: many(invitations),
}));

export const branchesRelations = relations(branches, ({ one, many }) => ({
  business: one(business, {
    fields: [branches.businessId],
    references: [business.id],
  }),
  memberships: many(businessMemberships),
  invitations: many(invitations),
  terminals: many(terminals),
  auditLogs: many(auditLogs),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(businessMemberships),
  invitationsSent: many(invitations),
  accessLogs: many(accessLogs),
  auditLogs: many(auditLogs),
}));

export const rolesRelations = relations(roles, ({ one, many }) => ({
  business: one(business, {
    fields: [roles.businessId],
    references: [business.id],
  }),
  memberships: many(businessMemberships),
  invitations: many(invitations),
  endpointRoleAccess: many(endpointRoleAccess),
}));

export const businessMembershipsRelations = relations(
  businessMemberships,
  ({ one }) => ({
    business: one(business, {
      fields: [businessMemberships.businessId],
      references: [business.id],
    }),
    user: one(users, {
      fields: [businessMemberships.userId],
      references: [users.id],
    }),
    role: one(roles, {
      fields: [businessMemberships.roleId],
      references: [roles.id],
    }),
    branch: one(branches, {
      fields: [businessMemberships.branchId],
      references: [branches.id],
    }),
  }),
);

export const invitationsRelations = relations(invitations, ({ one }) => ({
  business: one(business, {
    fields: [invitations.businessId],
    references: [business.id],
  }),
  role: one(roles, {
    fields: [invitations.roleId],
    references: [roles.id],
  }),
  branch: one(branches, {
    fields: [invitations.branchId],
    references: [branches.id],
  }),
  invitedByUser: one(users, {
    fields: [invitations.invitedByUserId],
    references: [users.id],
  }),
  invitedByPlatformUser: one(platformUsers, {
    fields: [invitations.invitedByPlatformUserId],
    references: [platformUsers.id],
  }),
}));

export const terminalsRelations = relations(terminals, ({ one, many }) => ({
  business: one(business, {
    fields: [terminals.businessId],
    references: [business.id],
  }),
  branch: one(branches, {
    fields: [terminals.branchId],
    references: [branches.id],
  }),
  auditLogs: many(auditLogs),
}));

export const accessLogsRelations = relations(accessLogs, ({ one }) => ({
  business: one(business, {
    fields: [accessLogs.businessId],
    references: [business.id],
  }),
  user: one(users, {
    fields: [accessLogs.userId],
    references: [users.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  business: one(business, {
    fields: [auditLogs.businessId],
    references: [business.id],
  }),
  branch: one(branches, {
    fields: [auditLogs.branchId],
    references: [branches.id],
  }),
  terminal: one(terminals, {
    fields: [auditLogs.terminalId],
    references: [terminals.id],
  }),
  user: one(users, {
    fields: [auditLogs.userId],
    references: [users.id],
  }),
}));
