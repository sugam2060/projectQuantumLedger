import { Injectable } from '@nestjs/common';
import {
  ThrottleStorage,
  type ThrottleHit,
} from '../common/throttling/throttle-storage';
import { RedisService } from './redis.service';

/**
 * Atomic fixed-window counter: INCR, and start the window on the first hit.
 * Returns the count and the remaining window in milliseconds. The PTTL fallback
 * repairs a key that somehow lost its expiry.
 */
const INCREMENT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if hits == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { hits, ttl }
`;

/** Redis-backed throttle counters, shared by every app instance. */
@Injectable()
export class RedisThrottleStorage extends ThrottleStorage {
  constructor(private readonly redis: RedisService) {
    super();
  }

  async increment(key: string, ttlMs: number): Promise<ThrottleHit> {
    const [totalHits, msBeforeReset] = await this.redis.eval<[number, number]>(
      INCREMENT_SCRIPT,
      1,
      key,
      ttlMs,
    );
    return { totalHits, msBeforeReset };
  }
}
