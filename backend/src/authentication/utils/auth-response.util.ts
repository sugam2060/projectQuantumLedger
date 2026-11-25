import type { Response } from 'express';
import type { AuditRequestContext } from '../../audit-logs';
import type { AuthCookieService, CookieAudience } from '../auth-cookie.service';
import { ClientType, isBrowserClient } from '../dto/client-login.dto';
import type { AuthMetadata } from '../types';

type TokenPair = { refreshToken: string; refreshMaxAgeMs: number | undefined };

/**
 * Delivers a token pair the way the client expects: browsers get the refresh
 * token as an httpOnly cookie (never in the body); native clients get it in the
 * JSON body. The access token is always in the body.
 */
export function deliverTokens<T extends TokenPair>(
  result: T,
  clientType: ClientType | undefined,
  response: Response,
  cookies: AuthCookieService,
  audience: CookieAudience,
): Omit<T, 'refreshMaxAgeMs' | 'refreshToken'> & { refreshToken?: string } {
  const { refreshMaxAgeMs, refreshToken, ...rest } = result;
  if (!isBrowserClient(clientType)) return { ...rest, refreshToken };

  cookies.setRefreshCookie(response, audience, refreshToken, refreshMaxAgeMs);
  return rest;
}

/** Builds the sign-in metadata from validated headers and the audit context. */
export function authMetadata(
  clientType: ClientType | undefined,
  terminalId: string | undefined,
  audit: AuditRequestContext,
): AuthMetadata {
  return {
    clientType: clientType ?? ClientType.WEB,
    terminalId,
    userAgent: audit.userAgent,
    ip: audit.ipAddress,
    audit: { ...audit, clientType: clientType ?? ClientType.WEB, terminalId },
  };
}
