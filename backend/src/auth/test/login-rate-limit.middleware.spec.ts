import { InternalServerErrorException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { RedisService } from '../../redis/redis.service';
import { LoginRateLimitMiddleware } from '../middleware/login-rate-limit.middleware';

describe('LoginRateLimitMiddleware', () => {
  let middleware: LoginRateLimitMiddleware;
  const redis = {
    client: {
      eval: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    redis.client.eval.mockResolvedValue([1, 0]);
    middleware = new LoginRateLimitMiddleware(redis as unknown as RedisService);
  });

  it('tracks login attempts in an atomic Redis sliding window per IP', async () => {
    const request = createRequest('203.0.113.8');
    const response = createResponse();
    const next = jest.fn();

    await middleware.use(request, response as unknown as Response, next);

    expect(redis.client.eval).toHaveBeenCalledWith(
      expect.stringContaining('ZREMRANGEBYSCORE'),
      1,
      expect.stringMatching(
        /^auth:rate-limit:login:sliding:[a-f0-9]{64}$/,
      ),
      expect.any(Number),
      60_000,
      10,
      expect.any(String),
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 429 with the remaining window after the limit is exceeded', async () => {
    redis.client.eval.mockResolvedValueOnce([0, 42_000]);
    const response = createResponse();
    const next = jest.fn();

    await middleware.use(
      createRequest('203.0.113.8'),
      response as unknown as Response,
      next,
    );

    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '42');
    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 429,
      message: 'Too many login attempts',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards Redis failures instead of allowing the login request', async () => {
    const error = new Error('Redis unavailable');
    redis.client.eval.mockRejectedValueOnce(error);
    const next = jest.fn();

    await middleware.use(
      createRequest('203.0.113.8'),
      createResponse() as unknown as Response,
      next,
    );

    expect(next).toHaveBeenCalledWith(error);
  });

  it('forwards malformed Redis results as internal errors', async () => {
    redis.client.eval.mockResolvedValueOnce('invalid');
    const next = jest.fn();

    await middleware.use(
      createRequest('203.0.113.8'),
      createResponse() as unknown as Response,
      next,
    );

    expect(next).toHaveBeenCalledWith(
      expect.any(InternalServerErrorException),
    );
  });
});

function createRequest(ip: string): Request {
  return {
    ip,
    socket: { remoteAddress: ip },
  } as Request;
}

function createResponse() {
  const response = {
    setHeader: jest.fn(),
    status: jest.fn(),
    json: jest.fn(),
  };
  response.status.mockReturnValue(response);
  return response;
}
