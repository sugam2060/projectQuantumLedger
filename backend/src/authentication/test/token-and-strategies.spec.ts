import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthConfig } from '../../config';
import { JwtStrategy } from '../strategies/jwt.strategy';
import { PlatformJwtStrategy } from '../strategies/platform-jwt.strategy';
import { TokenService } from '../token.service';

const config: AuthConfig = {
  jwtSecret: 'test-jwt-secret-that-is-at-least-32-characters',
  accessTtl: '15m',
  accessTtlSeconds: 900,
  issuer: 'fortis-api',
  audience: 'fortis-pos',
  platformAudience: 'fortis-platform',
  refreshPersistentTtlSeconds: 30 * 86_400,
  refreshSessionTtlSeconds: 12 * 3600,
  passwordResetTtlMinutes: 30,
};

const USER_ID = '00000000-0000-4000-8000-000000000001';
const BUSINESS_ID = '00000000-0000-4000-8000-000000000002';

describe('TokenService', () => {
  const jwt = new JwtService({ secret: config.jwtSecret });
  const tokens = new TokenService(jwt, config);

  it('signs user tokens with issuer, user audience and the configured lifetime', async () => {
    const signed = await tokens.signUserToken({
      sub: USER_ID,
      email: 'owner@fortis.test',
      name: 'Owner',
      businessId: BUSINESS_ID,
      isOwner: true,
    });
    const payload = await jwt.verifyAsync<Record<string, unknown>>(
      signed.token,
      { issuer: 'fortis-api', audience: 'fortis-pos' },
    );
    expect(payload).toMatchObject({ sub: USER_ID, businessId: BUSINESS_ID });
    expect(Number(payload.exp) - Number(payload.iat)).toBe(900);
    expect(signed).toMatchObject({ expiresIn: '15m', expiresInSeconds: 900 });
  });

  it('gives platform tokens a different audience', async () => {
    const signed = await tokens.signPlatformToken({
      sub: USER_ID,
      platformUserId: USER_ID,
      email: 'staff@fortis.test',
      isPlatform: true,
      isBootstrap: false,
      role: 'support',
    });
    await expect(
      jwt.verifyAsync(signed.token, { audience: 'fortis-pos' }),
    ).rejects.toThrow();
    await expect(
      jwt.verifyAsync(signed.token, { audience: 'fortis-platform' }),
    ).resolves.toMatchObject({ sub: USER_ID });
  });
});

describe('JwtStrategy (business users)', () => {
  const strategy = new JwtStrategy(config);
  const exp = () => Math.floor(Date.now() / 1000) + 600;

  it('maps claims to the authenticated user', () => {
    expect(
      strategy.validate({
        sub: USER_ID,
        email: 'owner@fortis.test',
        name: 'Owner',
        businessId: BUSINESS_ID,
        isOwner: true,
        role_version: 3,
        exp: exp(),
        iat: 1,
      }),
    ).toMatchObject({
      userId: USER_ID,
      subjectId: USER_ID,
      businessId: BUSINESS_ID,
      isOwner: true,
      isPlatform: false,
      roleVersion: 3,
    });
  });

  it.each([
    ['non-uuid subject', { sub: 'nope' }],
    ['bad role version', { sub: USER_ID, role_version: 0 }],
    ['bad business id', { sub: USER_ID, businessId: 'x' }],
    ['expired', { sub: USER_ID, exp: 1 }],
  ])('rejects a token with %s', (_case, claims) => {
    expect(() => strategy.validate({ exp: exp(), ...claims })).toThrow(
      UnauthorizedException,
    );
  });

  it('refuses to start with a short secret', () => {
    expect(() => new JwtStrategy({ ...config, jwtSecret: 'short' })).toThrow(
      '32',
    );
  });
});

describe('PlatformJwtStrategy', () => {
  it('always marks the caller as a platform user', () => {
    const strategy = new PlatformJwtStrategy(config);
    const user = strategy.validate({
      sub: USER_ID,
      isBootstrap: true,
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    expect(user).toMatchObject({
      platformUserId: USER_ID,
      isPlatform: true,
      isBootstrap: true,
    });
    expect(user.userId).toBeUndefined();
  });
});
