import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuditRequestContext } from '../types';

/**
 * Collects the HTTP details stored on audit rows (method, route path, request id,
 * client type, IP, user agent) so handlers don't read `req` themselves.
 */
export const AuditContext = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuditRequestContext => {
    const request = context.switchToHttp().getRequest<Request>();
    const routePath = (request.route as { path?: unknown } | undefined)?.path;
    return {
      method: request.method,
      endpointPath: typeof routePath === 'string' ? routePath : undefined,
      requestId: request.header('x-request-id'),
      clientType: request.header('x-client-type'),
      ipAddress: request.ip,
      userAgent: request.header('user-agent'),
    };
  },
);
