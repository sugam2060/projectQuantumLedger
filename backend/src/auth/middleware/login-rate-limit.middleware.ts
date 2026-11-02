import {
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  NestMiddleware,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { RedisService } from '../../redis/redis.service';
import { LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_SECONDS } from '../auth.constants';

const SLIDING_WINDOW_SCRIPT = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
local count = redis.call('ZCARD', KEYS[1])
if count >= limit then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return {0, math.max(1, tonumber(oldest[2]) + window - now)}
end
redis.call('ZADD', KEYS[1], now, ARGV[4])
redis.call('PEXPIRE', KEYS[1], window)
return {1, 0}
`;

@Injectable()
export class LoginRateLimitMiddleware implements NestMiddleware {
  constructor(private readonly redisService: RedisService) {}

  async use(
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> {
    const clientIp = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    const ipHash = createHash('sha256').update(clientIp).digest('hex');
    const windowMilliseconds = LOGIN_RATE_WINDOW_SECONDS * 1000;

    let result: unknown;
    try {
      result = await this.redisService.client.eval(
        SLIDING_WINDOW_SCRIPT,
        1,
        `auth:rate-limit:login:sliding:${ipHash}`,
        Date.now(),
        windowMilliseconds,
        LOGIN_RATE_LIMIT,
        randomUUID(),
      );
    } catch (error) {
      next(error);
      return;
    }

    if (
      !Array.isArray(result) ||
      (result[0] !== 0 && result[0] !== 1) ||
      typeof result[1] !== 'number' ||
      !Number.isFinite(result[1])
    ) {
      next(
        new InternalServerErrorException(
          'Unable to verify login rate limit',
        ),
      );
      return;
    }

    const [allowed, retryAfterMilliseconds] = result;
    if (allowed === 1) {
      next();
      return;
    }

    response.setHeader(
      'Retry-After',
      String(Math.max(1, Math.ceil(retryAfterMilliseconds / 1000))),
    );
    response.status(HttpStatus.TOO_MANY_REQUESTS).json({
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      message: 'Too many login attempts',
    });
  }
}
