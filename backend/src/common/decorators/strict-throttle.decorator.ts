import { SetMetadata } from '@nestjs/common';
import {
  SKIP_THROTTLE_KEY,
  STRICT_THROTTLE_KEY,
  THROTTLE_OVERRIDE_KEY,
  type ThrottleOverride,
} from '../throttling/throttling.constants';

/**
 * Also applies the strict `auth` throttler (AUTH_THROTTLE_LIMIT per
 * THROTTLE_TTL_MS, per client IP and route) on top of the default one. Use it on
 * credential routes: login, refresh, owner registration, password flows.
 */
export const StrictThrottle = () => SetMetadata(STRICT_THROTTLE_KEY, true);

/**
 * Replaces the default throttler's limit and window for this route (for routes
 * with a documented, product-specific limit). Handler metadata wins over class.
 */
export const Throttle = (override: ThrottleOverride) =>
  SetMetadata(THROTTLE_OVERRIDE_KEY, override);

/** Turns throttling off for a route or controller (health probes, webhooks). */
export const SkipThrottle = () => SetMetadata(SKIP_THROTTLE_KEY, true);
