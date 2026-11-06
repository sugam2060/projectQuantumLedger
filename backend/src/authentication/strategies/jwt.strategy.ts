import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { RequestSession } from '../../database/request_context.service';

export interface AuthenticatedUser extends RequestSession {
  permissions: string[];
  role?: string;
}

interface JwtPayload {
  sub?: unknown;
  userId?: unknown;
  businessId?: unknown;
  branchId?: unknown;
  platformUserId?: unknown;
  isPlatform?: unknown;
  isOwner?: unknown;
  role?: unknown;
  permissions?: unknown;
  exp?: unknown;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    const secret = configService.getOrThrow<string>('JWT_SECRET');
    if (secret.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters long');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
      algorithms: ['HS256'],
    });
  }

  validate(payload: JwtPayload): AuthenticatedUser {
    if (
      typeof payload.exp !== 'number' ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      throw new UnauthorizedException('JWT must have a valid expiration');
    }

    const subject = this.requireUuid(payload.sub, 'sub');
    const isPlatform = payload.isPlatform === true;
    const claimedUserId = this.optionalUuid(payload.userId, 'userId');
    if (!isPlatform && claimedUserId && claimedUserId !== subject) {
      throw new UnauthorizedException('userId claim must match sub');
    }

    const userId = isPlatform ? undefined : subject;
    const platformUserId = isPlatform
      ? this.requireUuid(payload.platformUserId ?? subject, 'platformUserId')
      : undefined;

    if (!this.isStringArray(payload.permissions)) {
      throw new UnauthorizedException('Invalid permissions claim');
    }

    return {
      userId,
      businessId: this.optionalUuid(payload.businessId, 'businessId'),
      branchId: this.optionalUuid(payload.branchId, 'branchId'),
      platformUserId,
      isPlatform,
      isOwner: payload.isOwner === true,
      role: typeof payload.role === 'string' ? payload.role : undefined,
      permissions: payload.permissions ?? [],
    };
  }

  private requireUuid(value: unknown, claim: string): string {
    const uuid = this.optionalUuid(value, claim);
    if (!uuid) {
      throw new UnauthorizedException(`Missing or invalid ${claim} claim`);
    }
    return uuid;
  }

  private optionalUuid(value: unknown, claim: string): string | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
      throw new UnauthorizedException(`Invalid ${claim} claim`);
    }
    return value;
  }

  private isStringArray(value: unknown): value is string[] | undefined {
    return (
      value === undefined ||
      (Array.isArray(value) &&
        value.every((item): item is string => typeof item === 'string'))
    );
  }
}
