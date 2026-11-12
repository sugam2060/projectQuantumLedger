import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { cookieParserMiddleware } from '../cookie-parser.middleware';
import type { NextFunction, Request, Response } from 'express';

describe('cookieParserMiddleware', () => {
  it('parses and decodes cookie values before guards execute', () => {
    const request = {
      headers: {
        cookie: 'access_token=access%2Btoken; refresh_token=refresh-token',
      },
    } as Request & { cookies?: Record<string, string> };
    const next = jest.fn() as NextFunction;

    cookieParserMiddleware(request, {} as Response, next);

    expect(request.cookies).toEqual({
      access_token: 'access+token',
      refresh_token: 'refresh-token',
    });
    expect(next).toHaveBeenCalledTimes(1);
  });
});
