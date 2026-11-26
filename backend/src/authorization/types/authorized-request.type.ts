import type { Request } from 'express';
import type { AuthenticatedUser } from '../../common/types';

/** A request after PermissionGuard authorized it for a business (and branch). */
export type AuthorizedRequest = Request & {
  user?: AuthenticatedUser;
  authorizedBusinessId?: string;
  authorizedBranchId?: string;
};
