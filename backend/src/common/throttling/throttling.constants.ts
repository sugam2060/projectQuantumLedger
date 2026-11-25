/** Injection token for the throttler limits (see `ThrottlerSettings`). */
export const THROTTLER_SETTINGS = 'THROTTLER_SETTINGS';

/** Metadata keys read by `ThrottleGuard`. */
export const THROTTLE_OVERRIDE_KEY = 'throttle:override';
export const STRICT_THROTTLE_KEY = 'throttle:strict';
export const SKIP_THROTTLE_KEY = 'throttle:skip';

/** Throttler names; used in Redis keys and response header suffixes. */
export const DEFAULT_THROTTLER = 'default';
export const AUTH_THROTTLER = 'auth';

/** Limits the guard enforces (built from `throttleConfig`). */
export type ThrottlerSettings = {
  ttlMs: number;
  limit: number;
  authLimit: number;
};

/** Per-route replacement for the default throttler's limit and window. */
export type ThrottleOverride = {
  limit: number;
  ttlMs: number;
};
