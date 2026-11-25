import { MemoryThrottleStorage } from '../throttling/memory-throttle.storage';

describe('MemoryThrottleStorage', () => {
  it('counts within a window and restarts after it expires', async () => {
    let now = 1_000;
    const storage = new MemoryThrottleStorage(() => now);

    await expect(storage.increment('k', 500)).resolves.toEqual({
      totalHits: 1,
      msBeforeReset: 500,
    });
    now = 1_200;
    await expect(storage.increment('k', 500)).resolves.toEqual({
      totalHits: 2,
      msBeforeReset: 300,
    });
    now = 1_600;
    await expect(storage.increment('k', 500)).resolves.toEqual({
      totalHits: 1,
      msBeforeReset: 500,
    });
  });

  it('keeps keys independent', async () => {
    const storage = new MemoryThrottleStorage(() => 0);
    await storage.increment('a', 1000);
    await expect(storage.increment('b', 1000)).resolves.toMatchObject({
      totalHits: 1,
    });
  });
});
