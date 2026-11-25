import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import {
  type ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AllExceptionsFilter } from '../filters/all-exceptions.filter';

type CapturedResponse = { status: number; body: unknown };

function hostFor(requestId?: string): {
  host: ArgumentsHost;
  captured: CapturedResponse;
} {
  const captured: CapturedResponse = { status: 0, body: undefined };
  const response = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
      return this;
    },
  };
  const request = { requestId, method: 'GET', url: '/api/v1/x' };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { host, captured };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('keeps the status and message of an HttpException', () => {
    const { host, captured } = hostFor('req-1');
    filter.catch(new NotFoundException('Business was not found'), host);
    expect(captured).toEqual({
      status: 404,
      body: {
        statusCode: 404,
        error: 'Not Found',
        message: 'Business was not found',
        requestId: 'req-1',
      },
    });
  });

  it('keeps validation messages as an array', () => {
    const { host, captured } = hostFor();
    filter.catch(
      new BadRequestException(['email must be an email', 'name is required']),
      host,
    );
    expect(captured.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: ['email must be an email', 'name is required'],
    });
  });

  it('keeps a machine-readable error code set by the thrower', () => {
    const { host, captured } = hostFor();
    filter.catch(
      new ForbiddenException({
        error: 'EMAIL_NOT_VERIFIED',
        message: 'Verify your email first',
      }),
      host,
    );
    expect(captured.body).toEqual({
      statusCode: 403,
      error: 'EMAIL_NOT_VERIFIED',
      message: 'Verify your email first',
    });
  });

  it('maps a plain string HttpException', () => {
    const { host, captured } = hostFor();
    filter.catch(new HttpException('Nope', HttpStatus.CONFLICT), host);
    expect(captured.body).toEqual({
      statusCode: 409,
      error: 'Conflict',
      message: 'Nope',
    });
  });

  it('answers 429 for throttling', () => {
    const { host, captured } = hostFor();
    filter.catch(
      new HttpException('Too many requests. Try again later.', 429),
      host,
    );
    expect(captured.status).toBe(429);
    expect(captured.body).toMatchObject({
      statusCode: 429,
      error: 'Too Many Requests',
    });
  });

  it('maps a unique violation to 409 without leaking SQL', () => {
    const { host, captured } = hostFor();
    filter.catch(
      Object.assign(
        new Error('duplicate key value violates "users_email_uq"'),
        {
          code: '23505',
        },
      ),
      host,
    );
    expect(captured).toEqual({
      status: 409,
      body: {
        statusCode: 409,
        error: 'Conflict',
        message: 'Resource already exists',
      },
    });
  });

  it('maps insufficient_privilege (RLS / grants) to 403', () => {
    const { host, captured } = hostFor();
    filter.catch({ cause: { code: '42501' } }, host);
    expect(captured).toEqual({
      status: 403,
      body: { statusCode: 403, error: 'Forbidden', message: 'Forbidden' },
    });
  });

  it('hides unknown errors behind a generic 500 and logs them', () => {
    const { host, captured } = hostFor('req-9');
    const errorLog = jest.spyOn(Logger.prototype, 'error');
    filter.catch(new Error('connection string postgres://secret'), host);
    expect(captured).toEqual({
      status: 500,
      body: {
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'Internal server error',
        requestId: 'req-9',
      },
    });
    expect(errorLog).toHaveBeenCalled();
  });
});
