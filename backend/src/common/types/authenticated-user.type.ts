/**
 * `request.user` after a JWT has been validated. Platform users and business users
 * share this shape for now; `isPlatform` tells them apart.
 */
export type AuthenticatedUser = {
  subjectId: string;
  sub?: string;
  businessId?: string;
  userId?: string;
  branchId?: string;
  platformUserId?: string;
  platformAuthEmail?: string;
  isPlatform?: boolean;
  isOwner?: boolean;
  permissions: string[];
  name?: string;
  roleId?: string;
  roleVersion?: number;
  isBootstrap?: boolean;
  tokenIssuedAt?: number;
  tokenExpiresAt?: number;
};
