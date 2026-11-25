import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import type { RequestWithId } from '../types';
import {
  PG_INSUFFICIENT_PRIVILEGE,
  PG_UNIQUE_VIOLATION,
  postgresErrorCode,
} from '../utils/postgres-error.util';

/** JSON error body for every failed request. */
export type ErrorResponseBody = {
  statusCode: number;
  error: string;
  message: string | string[];
  requestId?: string;
};

const DEFAULT_ERROR_NAMES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'Bad Request',
  [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
  [HttpStatus.FORBIDDEN]: 'Forbidden',
  [HttpStatus.NOT_FOUND]: 'Not Found',
  [HttpStatus.CONFLICT]: 'Conflict',
  [HttpStatus.GONE]: 'Gone',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'Payload Too Large',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'Unprocessable Entity',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Too Many Requests',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'Service Unavailable',
};

const errorNameFor = (status: number): string =>
  DEFAULT_ERROR_NAMES[status] ??
  (status >= 500 ? 'Internal Server Error' : 'Error');

/**
 * The single global exception filter. It owns the error JSON shape
 * `{ statusCode, error, message, requestId? }`, maps database errors (unique
 * violation → 409, insufficient privilege → 403), and never returns stack traces,
 * SQL or driver messages. 5xx errors are logged with the request id.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<RequestWithId>();
    const body = this.toBody(exception);
    if (request.requestId) body.requestId = request.requestId;

    if (body.statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.url} failed (requestId=${request.requestId ?? 'n/a'})`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ErrorResponseBody {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        return {
          statusCode: status,
          error: errorNameFor(status),
          message: payload,
        };
      }
      const { error, message } = payload as {
        error?: unknown;
        message?: unknown;
      };
      return {
        statusCode: status,
        error: typeof error === 'string' ? error : errorNameFor(status),
        message:
          typeof message === 'string' || Array.isArray(message)
            ? (message as string | string[])
            : exception.message,
      };
    }

    const code = postgresErrorCode(exception);
    if (code === PG_UNIQUE_VIOLATION) {
      return {
        statusCode: HttpStatus.CONFLICT,
        error: errorNameFor(HttpStatus.CONFLICT),
        message: 'Resource already exists',
      };
    }
    if (code === PG_INSUFFICIENT_PRIVILEGE) {
      return {
        statusCode: HttpStatus.FORBIDDEN,
        error: errorNameFor(HttpStatus.FORBIDDEN),
        message: 'Forbidden',
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: errorNameFor(HttpStatus.INTERNAL_SERVER_ERROR),
      message: 'Internal server error',
    };
  }
}
