import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import {
  RateLimitMiddleware,
  RateLimitOptions,
} from '../../utils/ratelimit.middleware';
import { RATE_LIMIT_KEY } from '../decorators/rate-limit.decorator';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimitMiddleware: RateLimitMiddleware,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.get<RateLimitOptions>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );
    if (!options) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    let nextCalled = false;

    await this.rateLimitMiddleware.use(
      request,
      response,
      () => {
        nextCalled = true;
      },
      options,
    );

    return nextCalled || !response.headersSent;
  }
}
