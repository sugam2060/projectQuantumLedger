import { SetMetadata } from '@nestjs/common';

export const IS_SELF_SERVICE_KEY = 'isSelfService';

/**
 * Marks an authenticated route that acts only on the caller's own account
 * (change password, sign out everywhere). It needs no permission; the route
 * audit accepts it on platform routes instead of @RequiredPlatformPermission.
 */
export const SelfService = () => SetMetadata(IS_SELF_SERVICE_KEY, true);
