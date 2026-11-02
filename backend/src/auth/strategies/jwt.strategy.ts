import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { AuthSessionService } from '../auth-session.service';
import { ACCESS_TOKEN_COOKIE } from '../auth.constants';
import type {
  AuthenticatedUser,
  BranchAuthorization,
  MembershipAuthorization,
} from '../authenticated-user.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly authSessionService: AuthSessionService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        extractAccessCookie,
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
      algorithms: ['HS256'],
      issuer: 'quantum-ledger',
      audience: 'quantum-ledger-api',
    });
  }

  async validate(payload: unknown): Promise<AuthenticatedUser> {
    if (!isAccessTokenPayload(payload)) {
      throw new UnauthorizedException();
    }

    if (!(await this.authSessionService.isActive(payload.jti))) {
      throw new UnauthorizedException();
    }

    return {
      userId: payload.sub,
      sessionId: payload.jti,
      email: payload.email,
      roles: payload.roles,
      permissions: payload.permissions,
      memberships: payload.memberships,
    };
  }
}

interface AccessTokenPayload {
  sub: string;
  email: string;
  jti: string;
  roles: string[];
  permissions: string[];
  memberships: MembershipAuthorization[];
}

function isAccessTokenPayload(payload: unknown): payload is AccessTokenPayload {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('sub' in payload) ||
    !('email' in payload) ||
    !('jti' in payload) ||
    !('roles' in payload) ||
    !('permissions' in payload) ||
    !('memberships' in payload) ||
    typeof payload.sub !== 'string' ||
    typeof payload.email !== 'string' ||
    typeof payload.jti !== 'string' ||
    !isStringArray(payload.roles) ||
    !isStringArray(payload.permissions) ||
    !Array.isArray(payload.memberships)
  ) {
    return false;
  }

  return payload.memberships.every(isMembershipAuthorization);
}

function isMembershipAuthorization(
  value: unknown,
): value is MembershipAuthorization {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('businessId' in value) ||
    !('branchIds' in value) ||
    !('roles' in value) ||
    !('permissions' in value) ||
    !('branchAccess' in value) ||
    typeof value.businessId !== 'string' ||
    !isStringArray(value.branchIds) ||
    !isStringArray(value.roles) ||
    !isStringArray(value.permissions) ||
    !Array.isArray(value.branchAccess)
  ) {
    return false;
  }

  return value.branchAccess.every(isBranchAuthorization);
}

function isBranchAuthorization(value: unknown): value is BranchAuthorization {
  return (
    typeof value === 'object' &&
    value !== null &&
    'branchId' in value &&
    typeof value.branchId === 'string' &&
    'roles' in value &&
    isStringArray(value.roles) &&
    'permissions' in value &&
    isStringArray(value.permissions)
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function extractAccessCookie(request: Request): string | null {
  const cookies = request.headers.cookie;
  if (!cookies) {
    return null;
  }

  const tokenCookie = cookies
    .split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${ACCESS_TOKEN_COOKIE}=`));

  return tokenCookie?.slice(ACCESS_TOKEN_COOKIE.length + 1) || null;
}
