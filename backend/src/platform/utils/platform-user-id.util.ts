import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/types';

/**
 * Returns the platform user id of the caller, or throws 403 when the token is not a
 * platform token. Older tokens may lack `platformUserId`, so the verified subject is
 * the fallback.
 */
export function requirePlatformUserId(
  user: AuthenticatedUser | undefined,
): string {
  const platformUserId =
    user?.isPlatform === true
      ? (user.platformUserId ?? user.subjectId ?? user.userId ?? user.sub)
      : undefined;
  if (!platformUserId) {
    throw new ForbiddenException('Platform user authentication required');
  }
  return platformUserId;
}
