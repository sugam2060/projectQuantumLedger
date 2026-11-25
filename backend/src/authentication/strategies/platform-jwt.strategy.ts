import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PLATFORM_JWT_STRATEGY } from '../../common/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../common/types';
import { authConfig } from '../../config';
import {
  optionalStringClaim,
  requireExpiry,
  requireUuidClaim,
} from './token-claims.util';

type PlatformJwtPayload = {
  sub?: unknown;
  email?: unknown;
  isBootstrap?: unknown;
  exp?: unknown;
  iat?: unknown;
};

/** Platform-user (Fortis staff) access tokens: the platform audience only. */
@Injectable()
export class PlatformJwtStrategy extends PassportStrategy(
  Strategy,
  PLATFORM_JWT_STRATEGY,
) {
  constructor(@Inject(authConfig.KEY) config: ConfigType<typeof authConfig>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwtSecret,
      algorithms: ['HS256'],
      issuer: config.issuer,
      audience: config.platformAudience,
    });
  }

  validate(payload: PlatformJwtPayload): AuthenticatedUser {
    const tokenExpiresAt = requireExpiry(payload.exp);
    const platformUserId = requireUuidClaim(payload.sub, 'sub');
    return {
      subjectId: platformUserId,
      platformUserId,
      email: optionalStringClaim(payload.email, 'email'),
      isPlatform: true,
      isOwner: false,
      isBootstrap: payload.isBootstrap === true,
      permissions: [],
      tokenIssuedAt: typeof payload.iat === 'number' ? payload.iat : undefined,
      tokenExpiresAt,
    };
  }
}
