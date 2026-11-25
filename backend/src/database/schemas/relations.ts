import { relations } from 'drizzle-orm';
import { accessLogs } from './audit/access-logs';
import { auditLogs } from './audit/audit-logs';
import { platformAuditLogs } from './audit/platform-audit-logs';
import { branches } from './business/branches';
import { business } from './business/businesses';
import { businessProvisioningRequests } from './business/business-provisioning-requests';
import { ownerRedemptions } from './business/owner-redemptions';
import { businessMemberships } from './business/business-memberships';
import { endpointRoleAccess } from './business/endpoint-role-access';
import { invitations } from './business/invitations';
import { platformUsers } from './auth/platform-users';
import { roles } from './business/roles';
import { terminals } from './business/terminals';
import { users } from './auth/users';

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
  ownerRedemptions: many(ownerRedemptions),
  platformAuditLogs: many(platformAuditLogs),
}));

export const platformUsersRelations = relations(platformUsers, ({ many }) => ({
  businessesCreated: many(business),
  invitationsSent: many(invitations),
  businessRequestsReviewed: many(businessProvisioningRequests),
  ownerRedemptionsCreated: many(ownerRedemptions),
  platformAuditLogs: many(platformAuditLogs),
}));

export const businessProvisioningRequestRelations = relations(
  businessProvisioningRequests,
  ({ one, many }) => ({
    reviewer: one(platformUsers, {
      fields: [businessProvisioningRequests.reviewedBy],
      references: [platformUsers.id],
    }),
    provisionedBusiness: one(business, {
      fields: [businessProvisioningRequests.provisionedBusinessId],
      references: [business.id],
    }),
    ownerRedemption: one(ownerRedemptions, {
      fields: [businessProvisioningRequests.id],
      references: [ownerRedemptions.requestId],
    }),
    }),
);

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
  ownerRedemptionsConsumed: many(ownerRedemptions),
}));

export const ownerRedemptionsRelations = relations(
  ownerRedemptions,
  ({ one }) => ({
    business: one(business, {
      fields: [ownerRedemptions.businessId],
      references: [business.id],
    }),
    request: one(businessProvisioningRequests, {
      fields: [ownerRedemptions.requestId],
      references: [businessProvisioningRequests.id],
    }),
    createdByPlatformUser: one(platformUsers, {
      fields: [ownerRedemptions.createdByPlatformUserId],
      references: [platformUsers.id],
    }),
    consumedByUser: one(users, {
      fields: [ownerRedemptions.consumedByUserId],
      references: [users.id],
    }),
  }),
);

export const platformAuditLogsRelations = relations(
  platformAuditLogs,
  ({ one }) => ({
    platformUser: one(platformUsers, {
      fields: [platformAuditLogs.platformUserId],
      references: [platformUsers.id],
    }),
    business: one(business, {
      fields: [platformAuditLogs.businessId],
      references: [business.id],
    }),
    request: one(businessProvisioningRequests, {
      fields: [platformAuditLogs.requestId],
      references: [businessProvisioningRequests.id],
    }),
  }),
);

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
  accessLogs: many(accessLogs),
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
  terminal: one(terminals, {
    fields: [accessLogs.terminalId],
    references: [terminals.id],
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
