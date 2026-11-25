import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { appConfig } from '../config';

/** Refresh cookie name (unchanged from before, so clients keep working). */
export const REFRESH_COOKIE = 'refresh_token';

/** Who the cookie belongs to; decides the path it is scoped to. */
export type CookieAudience = 'user' | 'platform';

/**
 * Owns the refresh-token cookie for browser clients. The cookie is httpOnly,
 * SameSite=Lax, Secure in production, and scoped to the auth routes of its
 * audience so the browser never sends it anywhere else. Access tokens are never
 * put in cookies.
 */
@Injectable()
export class AuthCookieService {
  constructor(
    @Inject(appConfig.KEY)
    private readonly app: ConfigType<typeof appConfig>,
  ) {}

  /**
   * @param maxAgeMs set for "remember me" sessions; omitted for a browser-session
   *   cookie that disappears when the browser closes.
   */
  setRefreshCookie(
    response: Response,
    audience: CookieAudience,
    token: string,
    maxAgeMs?: number,
  ): void {
    response.cookie(REFRESH_COOKIE, token, {
      ...this.baseOptions(audience),
      ...(maxAgeMs === undefined ? {} : { maxAge: maxAgeMs }),
    });
  }

  clearRefreshCookie(response: Response, audience: CookieAudience): void {
    response.clearCookie(REFRESH_COOKIE, this.baseOptions(audience));
  }

  readRefreshCookie(request: Request): string | undefined {
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const value = cookies?.[REFRESH_COOKIE];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  /** Path the cookie is limited to, e.g. /api/v1/authentication. */
  cookiePath(audience: CookieAudience): string {
    return `${this.app.apiPrefix}/${audience === 'user' ? 'authentication' : 'platform/user'}`;
  }

  private baseOptions(audience: CookieAudience): CookieOptions {
    return {
      httpOnly: true,
      secure: this.app.isProduction,
      sameSite: 'lax',
      path: this.cookiePath(audience),
    };
  }
}
