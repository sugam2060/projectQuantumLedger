import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { USER_JWT_STRATEGY } from '../../common/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../common/types';
import { authConfig } from '../../config';
import {
  optionalStringClaim,
  optionalUuidClaim,
  requireExpiry,
  requireUuidClaim,
} from './token-claims.util';

export type { AuthenticatedUser };

type UserJwtPayload = {
  sub?: unknown;
  email?: unknown;
  name?: unknown;
  businessId?: unknown;
  branchId?: unknown;
  terminalId?: unknown;
  isOwner?: unknown;
  role_id?: unknown;
  role_version?: unknown;
  exp?: unknown;
  iat?: unknown;
};

/**
 * Business-user access tokens: Bearer header only, HS256 only, expiry, issuer
 * and the user audience enforced by passport-jwt before `validate` runs.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, USER_JWT_STRATEGY) {
  constructor(@Inject(authConfig.KEY) config: ConfigType<typeof authConfig>) {
    if (config.jwtSecret.length < 32) {
      throw new Error('JWT_ACCESS_SECRET must be at least 32 characters long');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwtSecret,
      algorithms: ['HS256'],
      issuer: config.issuer,
      audience: config.audience,
    });
  }

  validate(payload: UserJwtPayload): AuthenticatedUser {
    const tokenExpiresAt = requireExpiry(payload.exp);
    const userId = requireUuidClaim(payload.sub, 'sub');
    if (
      payload.role_version !== undefined &&
      (typeof payload.role_version !== 'number' ||
        !Number.isInteger(payload.role_version) ||
        payload.role_version < 1)
    ) {
      throw new UnauthorizedException('Invalid role_version claim');
    }

    return {
      subjectId: userId,
      userId,
      email: optionalStringClaim(payload.email, 'email'),
      name: optionalStringClaim(payload.name, 'name'),
      businessId: optionalUuidClaim(payload.businessId, 'businessId'),
      branchId: optionalUuidClaim(payload.branchId, 'branchId'),
      terminalId: optionalUuidClaim(payload.terminalId, 'terminalId'),
      roleId: optionalUuidClaim(payload.role_id, 'role_id'),
      roleVersion:
        typeof payload.role_version === 'number'
          ? payload.role_version
          : undefined,
      isPlatform: false,
      isOwner: payload.isOwner === true,
      permissions: [],
      tokenIssuedAt: typeof payload.iat === 'number' ? payload.iat : undefined,
      tokenExpiresAt,
    };
  }
}
