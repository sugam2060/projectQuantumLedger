import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { RedisThrottleStorage } from '../redis-throttle.storage';
import type { RedisService } from '../redis.service';

describe('RedisThrottleStorage', () => {
  it('runs one atomic script per hit and maps its result', async () => {
    const evalMock = jest.fn().mockResolvedValue([4, 1500]);
    const storage = new RedisThrottleStorage({
      eval: evalMock,
    } as unknown as RedisService);

    await expect(
      storage.increment('throttle:default:X.y:1.2.3.4', 60000),
    ).resolves.toEqual({
      totalHits: 4,
      msBeforeReset: 1500,
    });
    expect(evalMock).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('INCR'"),
      1,
      'throttle:default:X.y:1.2.3.4',
      60000,
    );
  });
});
