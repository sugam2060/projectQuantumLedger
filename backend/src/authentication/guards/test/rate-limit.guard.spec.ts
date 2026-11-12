import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimitGuard } from '../rate-limit.guard';
import { RateLimitMiddleware } from '../../../utils/ratelimit.middleware';

describe('RateLimitGuard', () => {
  const reflector = { get: jest.fn() };
  const middleware = { use: jest.fn() };
  const request = {};
  const response: { headersSent: boolean } = { headersSent: false };
  const context = {
    getHandler: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  let guard: RateLimitGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    response.headersSent = false;
    guard = new RateLimitGuard(
      reflector as unknown as Reflector,
      middleware as unknown as RateLimitMiddleware,
    );
  });

  it('allows routes without rate-limit metadata', async () => {
    reflector.get.mockReturnValue(undefined);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(middleware.use).not.toHaveBeenCalled();
  });

  it('delegates the route limit to the rate-limit middleware', async () => {
    const options = { requests: 60, windowMs: 60_000 };
    reflector.get.mockReturnValue(options);
    middleware.use.mockImplementation(async (_request, _response, next) =>
      next(),
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(middleware.use).toHaveBeenCalledWith(
      request,
      response,
      expect.any(Function),
      options,
    );
  });

  it('stops the route when the middleware sends a rate-limit response', async () => {
    reflector.get.mockReturnValue({ requests: 1, windowMs: 60_000 });
    middleware.use.mockImplementation(async () => {
      response.headersSent = true;
    });

    await expect(guard.canActivate(context)).resolves.toBe(false);
  });
});
