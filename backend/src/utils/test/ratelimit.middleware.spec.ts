import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { ConfigService } from '@nestjs/config';
import { RateLimitKeyGenerator } from '../rate-limit-key.generator';
import { RateLimitMiddleware } from '../ratelimit.middleware';
import { RedisService } from '../../redis/redis.service';

describe('RateLimitMiddleware', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('clears its heartbeat interval when the module is destroyed', async () => {
    jest.useFakeTimers();
    const redisService = {
      set: jest.fn().mockResolvedValue(undefined),
    } as unknown as RedisService;
    const middleware = new RateLimitMiddleware(
      redisService,
      {} as ConfigService,
      {} as RateLimitKeyGenerator,
    );

    await Promise.resolve();
    expect(jest.getTimerCount()).toBe(1);

    middleware.onModuleDestroy();

    expect(jest.getTimerCount()).toBe(0);
  });
});
