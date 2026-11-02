export interface BranchAuthorization {
  branchId: string;
  roles: string[];
  permissions: string[];
}

export interface MembershipAuthorization {
  businessId: string;
  branchIds: string[];
  roles: string[];
  permissions: string[];
  branchAccess: BranchAuthorization[];
}

export interface AuthenticatedUser {
  userId: string;
  sessionId: string;
  email: string;
  roles: string[];
  permissions: string[];
  memberships: MembershipAuthorization[];
}
