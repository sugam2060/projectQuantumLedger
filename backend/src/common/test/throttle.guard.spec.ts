import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { type ExecutionContext, HttpException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  SkipThrottle,
  StrictThrottle,
  Throttle,
} from '../decorators/strict-throttle.decorator';
import { ThrottleGuard } from '../guards/throttle.guard';
import {
  ThrottleStorage,
  type ThrottleHit,
} from '../throttling/throttle-storage';

class MemoryStorage extends ThrottleStorage {
  readonly counts = new Map<string, number>();
  increment(key: string, ttlMs: number): Promise<ThrottleHit> {
    const totalHits = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, totalHits);
    return Promise.resolve({ totalHits, msBeforeReset: ttlMs });
  }
}

class ProbeController {
  plain(): void {}

  @StrictThrottle()
  login(): void {}

  @Throttle({ limit: 2, ttlMs: 60_000 })
  limited(): void {}

  @SkipThrottle()
  health(): void {}
}

function contextFor(handler: keyof ProbeController, ip = '10.0.0.1') {
  const headers: Record<string, string | number> = {};
  const response = {
    setHeader: (name: string, value: string | number) => {
      headers[name] = value;
    },
  };
  const context = {
    getHandler: () => ProbeController.prototype[handler],
    getClass: () => ProbeController,
    switchToHttp: () => ({
      getRequest: () => ({ ip }),
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  return { context, headers };
}

describe('ThrottleGuard', () => {
  let storage: MemoryStorage;
  let guard: ThrottleGuard;

  beforeEach(() => {
    storage = new MemoryStorage();
    guard = new ThrottleGuard(new Reflector(), storage, {
      ttlMs: 60_000,
      limit: 3,
      authLimit: 1,
    });
  });

  it('applies the default limit to every route and sets rate-limit headers', async () => {
    const { context, headers } = contextFor('plain');
    for (let i = 0; i < 3; i += 1) {
      await expect(guard.canActivate(context)).resolves.toBe(true);
    }
    expect(headers['X-RateLimit-Limit']).toBe(3);
    expect(headers['X-RateLimit-Remaining']).toBe(0);

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 429,
    });
    expect(headers['Retry-After']).toBe(60);
  });

  it('counts clients and routes separately', async () => {
    for (let i = 0; i < 3; i += 1) {
      await guard.canActivate(contextFor('plain', '10.0.0.1').context);
    }
    await expect(
      guard.canActivate(contextFor('plain', '10.0.0.2').context),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(contextFor('limited', '10.0.0.1').context),
    ).resolves.toBe(true);
  });

  it('adds the strict auth throttler only on @StrictThrottle routes', async () => {
    const { context, headers } = contextFor('login');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(headers['X-RateLimit-Limit-auth']).toBe(1);
    const error = await guard.canActivate(context).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);

    const plain = contextFor('plain');
    await guard.canActivate(plain.context);
    expect(plain.headers['X-RateLimit-Limit-auth']).toBeUndefined();
  });

  it('uses a route override instead of the default limit', async () => {
    const { context } = contextFor('limited');
    await guard.canActivate(context);
    await guard.canActivate(context);
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 429,
    });
  });

  it('skips routes marked @SkipThrottle', async () => {
    const { context } = contextFor('health');
    for (let i = 0; i < 10; i += 1) {
      await expect(guard.canActivate(context)).resolves.toBe(true);
    }
    expect(storage.counts.size).toBe(0);
  });

  it('fails open when the storage is unavailable', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const failing = new ThrottleGuard(
      new Reflector(),
      {
        increment: () => Promise.reject(new Error('redis down')),
      } as ThrottleStorage,
      { ttlMs: 60_000, limit: 1, authLimit: 1 },
    );
    await expect(
      failing.canActivate(contextFor('login').context),
    ).resolves.toBe(true);
  });
});
