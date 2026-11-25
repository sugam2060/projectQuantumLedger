import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export const BusinessUploadHeaders = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<Request>();
    return { clientType: request.headers['x-client-type'] };
  },
);
