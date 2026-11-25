/** Result of counting one hit in a fixed window. */
export type ThrottleHit = {
  /** Hits in the current window, including this one. */
  totalHits: number;
  /** Milliseconds until the window resets. */
  msBeforeReset: number;
};

/**
 * Counter backend for `ThrottleGuard`. Abstract class so it can be used as a DI
 * token; the Redis implementation lives in `src/redis` (common/ stays infra-free).
 */
export abstract class ThrottleStorage {
  /** Counts one hit for `key` in a window of `ttlMs` and returns the window state. */
  abstract increment(key: string, ttlMs: number): Promise<ThrottleHit>;
}
