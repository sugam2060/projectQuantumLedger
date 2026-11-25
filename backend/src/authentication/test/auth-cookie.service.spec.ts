import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import type { Request, Response } from 'express';
import type { AppConfig } from '../../config';
import { AuthCookieService } from '../auth-cookie.service';
import { ClientType } from '../dto/client-login.dto';
import { deliverTokens } from '../utils/auth-response.util';

const appConfig = (isProduction: boolean): AppConfig => ({
  nodeEnv: isProduction ? 'production' : 'development',
  isProduction,
  port: 3001,
  apiPrefix: '/api/v1',
  frontendBaseUrl: undefined,
  corsOrigins: [],
  trustProxy: false,
});

const fakeResponse = () => {
  const cookie = jest.fn();
  const clearCookie = jest.fn();
  return {
    response: { cookie, clearCookie } as unknown as Response,
    cookie,
    clearCookie,
  };
};

describe('AuthCookieService', () => {
  it('scopes the refresh cookie to the audience auth path', () => {
    const cookies = new AuthCookieService(appConfig(false));
    const { response, cookie } = fakeResponse();

    cookies.setRefreshCookie(response, 'user', 'tok', 1000);
    cookies.setRefreshCookie(response, 'platform', 'tok');

    expect(cookie).toHaveBeenNthCalledWith(1, 'refresh_token', 'tok', {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/api/v1/authentication',
      maxAge: 1000,
    });
    expect(cookie).toHaveBeenNthCalledWith(2, 'refresh_token', 'tok', {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/api/v1/platform/user',
    });
  });

  it('marks the cookie Secure in production and clears it on the same path', () => {
    const cookies = new AuthCookieService(appConfig(true));
    const { response, cookie, clearCookie } = fakeResponse();
    cookies.setRefreshCookie(response, 'user', 'tok');
    cookies.clearRefreshCookie(response, 'user');
    expect(cookie.mock.calls[0][2]).toMatchObject({ secure: true });
    expect(clearCookie).toHaveBeenCalledWith(
      'refresh_token',
      expect.objectContaining({ path: '/api/v1/authentication' }),
    );
  });

  it('reads only a non-empty string cookie', () => {
    const cookies = new AuthCookieService(appConfig(false));
    const read = (value: unknown) =>
      cookies.readRefreshCookie({
        cookies: { refresh_token: value },
      } as unknown as Request);
    expect(read('abc')).toBe('abc');
    expect(read('')).toBeUndefined();
    expect(read(['abc'])).toBeUndefined();
  });
});

describe('deliverTokens', () => {
  const cookies = new AuthCookieService(appConfig(false));
  const result = {
    accessToken: 'access',
    refreshToken: 'refresh',
    refreshMaxAgeMs: 5000,
    tokenType: 'Bearer' as const,
  };

  it('puts both tokens in the body for native clients and sets no cookie', () => {
    const { response, cookie } = fakeResponse();
    expect(
      deliverTokens(result, ClientType.DESKTOP, response, cookies, 'user'),
    ).toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
      tokenType: 'Bearer',
    });
    expect(cookie).not.toHaveBeenCalled();
  });

  it.each([ClientType.WEB, ClientType.WEB_TERMINAL, undefined])(
    'keeps the refresh token out of the body for browser client %p',
    (clientType) => {
      const { response, cookie } = fakeResponse();
      expect(
        deliverTokens(result, clientType, response, cookies, 'user'),
      ).toEqual({ accessToken: 'access', tokenType: 'Bearer' });
      expect(cookie).toHaveBeenCalledWith(
        'refresh_token',
        'refresh',
        expect.objectContaining({ maxAge: 5000 }),
      );
    },
  );
});
