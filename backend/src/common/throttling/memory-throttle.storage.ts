import { ThrottleStorage, type ThrottleHit } from './throttle-storage';

const MAX_TRACKED_KEYS = 50_000;

/**
 * Per-process fixed-window counters. `ThrottleGuard` falls back to this when the
 * shared store is unavailable, so limits (most importantly on credential routes)
 * still apply per instance instead of being switched off. The key count is capped,
 * and expired windows are dropped first when the cap is reached.
 */
export class MemoryThrottleStorage extends ThrottleStorage {
  private readonly windows = new Map<
    string,
    { hits: number; resetAt: number }
  >();

  constructor(private readonly now: () => number = Date.now) {
    super();
  }

  increment(key: string, ttlMs: number): Promise<ThrottleHit> {
    const now = this.now();
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      if (!window && this.windows.size >= MAX_TRACKED_KEYS) this.evict(now);
      window = { hits: 0, resetAt: now + ttlMs };
      this.windows.set(key, window);
    }
    window.hits += 1;
    return Promise.resolve({
      totalHits: window.hits,
      msBeforeReset: window.resetAt - now,
    });
  }

  private evict(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
    // Still full: drop the oldest entries (Map keeps insertion order).
    for (const key of this.windows.keys()) {
      if (this.windows.size < MAX_TRACKED_KEYS) break;
      this.windows.delete(key);
    }
  }
}
