import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { RequestSession } from '../../database/request_context.service';

export interface AuthenticatedUser extends RequestSession {
  permissions: string[];
  name?: string;
  roleId?: string;
  roleVersion?: number;
  isBootstrap?: boolean;
  tokenIssuedAt?: number;
  tokenExpiresAt?: number;
}

interface JwtPayload {
  sub?: unknown;
  businessId?: unknown;
  branchId?: unknown;
  platformUserId?: unknown;
  isPlatform?: unknown;
  isBootstrap?: unknown;
  isOwner?: unknown;
  name?: unknown;
  role_id?: unknown;
  role_version?: unknown;
  permissions?: unknown;
  exp?: unknown;
  iat?: unknown;
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

    const userId = isPlatform ? undefined : subject;
    const platformUserId = isPlatform
      ? this.requireUuid(payload.platformUserId ?? subject, 'platformUserId')
      : undefined;

    if (!this.isStringArray(payload.permissions)) {
      throw new UnauthorizedException('Invalid permissions claim');
    }
    if (payload.name !== undefined && typeof payload.name !== 'string') {
      throw new UnauthorizedException('Invalid name claim');
    }
    if (
      payload.role_version !== undefined &&
      (typeof payload.role_version !== 'number' ||
        !Number.isInteger(payload.role_version) ||
        payload.role_version < 1)
    ) {
      throw new UnauthorizedException('Invalid role_version claim');
    }

    return {
      userId,
      businessId: this.optionalUuid(payload.businessId, 'businessId'),
      branchId: this.optionalUuid(payload.branchId, 'branchId'),
      name: typeof payload.name === 'string' ? payload.name : undefined,
      roleId: this.optionalUuid(payload.role_id, 'role_id'),
      roleVersion:
        typeof payload.role_version === 'number'
          ? payload.role_version
          : undefined,
      platformUserId,
      isPlatform,
      isOwner: payload.isOwner === true,
      isBootstrap: isPlatform && payload.isBootstrap === true,
      permissions: payload.permissions ?? [],
      tokenIssuedAt: typeof payload.iat === 'number' ? payload.iat : undefined,
      tokenExpiresAt: payload.exp,
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
