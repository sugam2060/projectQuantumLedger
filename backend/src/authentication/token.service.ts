import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { authConfig } from '../config';
import type {
  PlatformAccessTokenClaims,
  SignedAccessToken,
  UserAccessTokenClaims,
} from './types';

/**
 * Signs short-lived HS256 access tokens. Business-user and platform-user tokens
 * carry different audiences, so a token of one kind is rejected on the other's
 * routes. Every token carries `iss`, `aud`, `iat` and `exp`.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(authConfig.KEY)
    private readonly config: ConfigType<typeof authConfig>,
  ) {}

  signUserToken(claims: UserAccessTokenClaims): Promise<SignedAccessToken> {
    return this.sign({ ...claims }, this.config.audience);
  }

  signPlatformToken(
    claims: PlatformAccessTokenClaims,
  ): Promise<SignedAccessToken> {
    return this.sign({ ...claims }, this.config.platformAudience);
  }

  private async sign(
    payload: Record<string, unknown>,
    audience: string,
  ): Promise<SignedAccessToken> {
    const token = await this.jwt.signAsync(payload, {
      algorithm: 'HS256',
      issuer: this.config.issuer,
      audience,
      expiresIn: this.config.accessTtlSeconds,
    });
    return {
      token,
      expiresIn: this.config.accessTtl,
      expiresInSeconds: this.config.accessTtlSeconds,
    };
  }
}
