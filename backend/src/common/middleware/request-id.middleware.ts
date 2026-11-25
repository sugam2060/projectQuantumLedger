import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { RequestWithId } from '../types';

/** Lower-case header name, as Node stores incoming headers. */
export const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Gives every request an id: the client's `X-Request-Id` when it is short and safe,
 * otherwise a new UUID. The id is set on `request.requestId`, written back into the
 * request headers (audit context reads it there) and echoed in the response header.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: RequestWithId, response: Response, next: NextFunction): void {
    const incoming = request.headers[REQUEST_ID_HEADER];
    const requestId =
      typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming)
        ? incoming
        : randomUUID();
    request.requestId = requestId;
    request.headers[REQUEST_ID_HEADER] = requestId;
    response.setHeader('X-Request-Id', requestId);
    next();
  }
}
