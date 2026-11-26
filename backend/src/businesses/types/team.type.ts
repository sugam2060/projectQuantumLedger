/** A role as the API returns it. */
export type RoleView = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  branchId: string | null;
  version: number;
  permissions: string[];
};

/** A member of a business as the API returns it. */
export type MemberView = {
  userId: string;
  name: string;
  email: string;
  isOwner: boolean;
  branchId: string | null;
  role: { id: string; key: string; name: string } | null;
  joinedAt: Date;
};

export type MemberDetailView = MemberView & {
  overrides: { permissionKey: string; effect: string }[];
  effectivePermissions: string[];
};

/** An invitation as the API returns it (never its token). */
export type InvitationView = {
  id: string;
  email: string;
  roleId: string | null;
  branchId: string | null;
  status: 'open' | 'expired' | 'accepted' | 'revoked';
  expiresAt: Date;
  createdAt: Date;
};

export type InvitationResultStatus =
  'invited' | 'already_member' | 'already_invited' | 'invalid' | 'forbidden';

export type InvitationPreview = {
  email: string;
  businessName: string;
  roleName: string;
  branchName: string | null;
  expiresAt: Date;
  accountExists: boolean;
};

export type AcceptOutcome =
  | 'accepted'
  | 'invalid'
  | 'account_exists'
  | 'active_membership'
  | 'owner_elsewhere';
