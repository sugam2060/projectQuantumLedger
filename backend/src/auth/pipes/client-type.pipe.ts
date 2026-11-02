import {
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import type { Request } from 'express';

export type ClientType = 'desktop' | 'web' | 'mobile';

export const ClientTypeHeader = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | string[] | undefined =>
    context.switchToHttp().getRequest<Request>().headers['x-client-type'],
);

@Injectable()
export class ClientTypePipe implements PipeTransform<
  string | string[] | undefined,
  ClientType
> {
  transform(value: string | string[] | undefined): ClientType {
    if (value === 'desktop' || value === 'web' || value === 'mobile') {
      return value;
    }

    throw new BadRequestException(
      'x-client-type must be desktop, web, or mobile',
    );
  }
}
