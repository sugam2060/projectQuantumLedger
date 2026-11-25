/** Shape of the `throttle` config namespace (see `throttle.config.ts`). */
export type ThrottleConfig = {
  /** Window for both throttlers, in milliseconds. */
  ttlMs: number;
  /** Requests per window per client for every route. */
  limit: number;
  /** Requests per window per client for routes marked @StrictThrottle(). */
  authLimit: number;
};
