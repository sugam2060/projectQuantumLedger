import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { MemoryThrottleStorage } from '../throttling/memory-throttle.storage';
import {
  ThrottleStorage,
  type ThrottleHit,
} from '../throttling/throttle-storage';
import {
  AUTH_THROTTLER,
  DEFAULT_THROTTLER,
  SKIP_THROTTLE_KEY,
  STRICT_THROTTLE_KEY,
  THROTTLE_OVERRIDE_KEY,
  THROTTLER_SETTINGS,
  type ThrottleOverride,
  type ThrottlerSettings,
} from '../throttling/throttling.constants';

type ThrottlerRule = { name: string; limit: number; ttlMs: number };

/**
 * Global rate limiter, registered first in AppModule so floods are rejected before
 * any authentication work. Counts per client IP and per route in fixed windows:
 *
 * - `default` throttler on every route (THROTTLE_LIMIT per THROTTLE_TTL_MS),
 *   replaced per route by `@Throttle({ limit, ttlMs })`;
 * - `auth` throttler (AUTH_THROTTLE_LIMIT) added on `@StrictThrottle()` routes.
 *
 * The client IP is `request.ip`, so TRUST_PROXY must match the deployment. If the
 * shared counter store fails, the guard counts in process memory instead (limits
 * then apply per instance) and logs a warning, so no route is ever unthrottled.
 */
@Injectable()
export class ThrottleGuard implements CanActivate {
  private readonly logger = new Logger(ThrottleGuard.name);
  private readonly fallback = new MemoryThrottleStorage();

  constructor(
    private readonly reflector: Reflector,
    private readonly storage: ThrottleStorage,
    @Inject(THROTTLER_SETTINGS) private readonly settings: ThrottlerSettings,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(SKIP_THROTTLE_KEY, targets)) {
      return true;
    }

    const override = this.reflector.getAllAndOverride<
      ThrottleOverride | undefined
    >(THROTTLE_OVERRIDE_KEY, targets);
    const rules: ThrottlerRule[] = [
      {
        name: DEFAULT_THROTTLER,
        limit: override?.limit ?? this.settings.limit,
        ttlMs: override?.ttlMs ?? this.settings.ttlMs,
      },
    ];
    if (
      this.reflector.getAllAndOverride<boolean>(STRICT_THROTTLE_KEY, targets)
    ) {
      rules.push({
        name: AUTH_THROTTLER,
        limit: this.settings.authLimit,
        ttlMs: this.settings.ttlMs,
      });
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const routeKey = `${context.getClass().name}.${context.getHandler().name}`;
    const tracker = request.ip ?? 'unknown';

    for (const rule of rules) {
      const key = `throttle:${rule.name}:${routeKey}:${tracker}`;
      const hit = await this.count(key, rule.ttlMs);

      const suffix = rule.name === DEFAULT_THROTTLER ? '' : `-${rule.name}`;
      const resetSeconds = Math.max(1, Math.ceil(hit.msBeforeReset / 1000));
      response.setHeader(`X-RateLimit-Limit${suffix}`, rule.limit);
      response.setHeader(
        `X-RateLimit-Remaining${suffix}`,
        Math.max(0, rule.limit - hit.totalHits),
      );
      response.setHeader(`X-RateLimit-Reset${suffix}`, resetSeconds);

      if (hit.totalHits > rule.limit) {
        response.setHeader('Retry-After', resetSeconds);
        throw new HttpException(
          'Too many requests. Try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    return true;
  }

  private async count(key: string, ttlMs: number): Promise<ThrottleHit> {
    try {
      return await this.storage.increment(key, ttlMs);
    } catch (error) {
      this.logger.warn(
        `Throttle store unavailable, counting in memory: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.fallback.increment(key, ttlMs);
    }
  }
}
