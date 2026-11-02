import { businesses, businessRelations } from './identity_and_multi_tenancy/businesses';
import { branches, branchesRelations } from './identity_and_multi_tenancy/branches';
import { terminals, terminalsRelations } from './identity_and_multi_tenancy/terminals';
import { users, usersRelations } from './identity_and_multi_tenancy/users';
import { businessMemberships, businessMembershipsRelations } from './identity_and_multi_tenancy/businessMembership';
import { roles, rolesRelations } from './identity_and_multi_tenancy/roles';
import { invitations, invitationsRelations } from './identity_and_multi_tenancy/invitations';
import { membershipRoles, membershipRolesRelations } from './identity_and_multi_tenancy/membershipRoles';
import { permissions, permissionsRelations } from './identity_and_multi_tenancy/permission';
import { rolePermissions, rolePermissionsRelations } from './identity_and_multi_tenancy/rolePermission';
import { branchAssignments, branchAssignmentsRelations } from './identity_and_multi_tenancy/branchAssignment';
import { accessAuditEvents } from './identity_and_multi_tenancy/accessAuditEvents';

// Export all tables
export {
  businesses,
  branches,
  terminals,
  users,
  businessMemberships,
  roles,
  invitations,
  membershipRoles,
  permissions,
  rolePermissions,
  branchAssignments,
  accessAuditEvents,
};

// Export all relations
export {
  businessRelations,
  branchesRelations,
  terminalsRelations,
  usersRelations,
  businessMembershipsRelations,
  rolesRelations,
  invitationsRelations,
  membershipRolesRelations,
  permissionsRelations,
  rolePermissionsRelations,
  branchAssignmentsRelations,
};

// Export schema object for Drizzle Kit
export const schema = {
  businesses,
  branches,
  terminals,
  users,
  businessMemberships,
  roles,
  invitations,
  membershipRoles,
  permissions,
  rolePermissions,
  branchAssignments,
  accessAuditEvents,
};