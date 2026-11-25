import { SetMetadata } from '@nestjs/common';

/** Metadata key read by `JwtAuthGuard`. */
export const IS_PLATFORM_ROUTE_KEY = 'isPlatformRoute';

/**
 * Marks a controller or route as Fortis-staff only: `JwtAuthGuard` then accepts
 * platform access tokens (platform audience) and rejects business-user tokens.
 * Routes without it accept only business-user tokens.
 */
export const PlatformRoute = () => SetMetadata(IS_PLATFORM_ROUTE_KEY, true);
