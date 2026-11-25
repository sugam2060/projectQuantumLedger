import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** Extracts { clientType } from the X-Client-Type header (validated by the DTO). */
export const ClientTypeHeaders = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<Request>();
    return {
      clientType: request.headers['x-client-type'],
    };
  },
);
