import { SetMetadata } from '@nestjs/common';

/** Metadata key read by the global auth guards. */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Opts a route (or a whole controller) out of authentication. Guards read it with
 * `Reflector.getAllAndOverride(IS_PUBLIC_KEY, [handler, class])`.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
