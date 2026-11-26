/**
 * `request.user` after an access token has been validated. Business users come
 * from the `jwt` strategy (isPlatform false), Fortis staff from `platform-jwt`
 * (isPlatform true); the two token kinds have different audiences.
 */
export type AuthenticatedUser = {
  subjectId: string;
  sub?: string;
  businessId?: string;
  userId?: string;
  email?: string;
  terminalId?: string;
  branchId?: string;
  platformUserId?: string;
  isPlatform?: boolean;
  isOwner?: boolean;
  permissions: string[];
  name?: string;
  roleId?: string;
  roleVersion?: number;
  isBootstrap?: boolean;
  /** Platform users: role from the token (admin | manager | support). */
  platformRole?: string;
  tokenIssuedAt?: number;
  tokenExpiresAt?: number;
};
