import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/types';

/**
 * Only the owner of this business may continue. The authorization refactor replaces
 * this with `@RequiredPermission` on the route.
 */
export function requireBusinessOwner(
  user: AuthenticatedUser | undefined,
  businessId: string,
): AuthenticatedUser {
  if (
    !user ||
    user.isOwner !== true ||
    user.isPlatform === true ||
    user.businessId !== businessId
  ) {
    throw new ForbiddenException('Business owner access required');
  }
  return user;
}

/** The caller must be a business user of this business (not a platform user). */
export function requireBusinessMember(
  user: AuthenticatedUser | undefined,
  businessId: string,
): AuthenticatedUser {
  if (
    !user ||
    user.isPlatform === true ||
    !user.businessId ||
    user.businessId !== businessId
  ) {
    throw new ForbiddenException('Business branch access required');
  }
  return user;
}
