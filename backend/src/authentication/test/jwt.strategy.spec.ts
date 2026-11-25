import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from '../strategies/jwt.strategy';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  beforeEach(() => {
    strategy = new JwtStrategy({
      jwtSecret: 'test-jwt-secret-that-is-at-least-32-characters',
    });
  });

  it('maps user and role template claims from the verified token', () => {
    const now = Math.floor(Date.now() / 1000);
    const user = strategy.validate({
      sub: '00000000-0000-4000-8000-000000000001',
      name: 'Cashier One',
      businessId: '00000000-0000-4000-8000-000000000002',
      branchId: '00000000-0000-4000-8000-000000000003',
      isPlatform: false,
      isOwner: false,
      role_id: '00000000-0000-4000-8000-000000000004',
      role_version: 7,
      iat: now,
      exp: now + 900,
    });

    expect(user).toMatchObject({
      userId: '00000000-0000-4000-8000-000000000001',
      name: 'Cashier One',
      businessId: '00000000-0000-4000-8000-000000000002',
      branchId: '00000000-0000-4000-8000-000000000003',
      roleId: '00000000-0000-4000-8000-000000000004',
      roleVersion: 7,
      permissions: [],
    });
  });

  it('rejects malformed role template claims', () => {
    const now = Math.floor(Date.now() / 1000);

    expect(() =>
      strategy.validate({
        sub: '00000000-0000-4000-8000-000000000001',
        isPlatform: false,
        role_id: 'not-a-uuid',
        role_version: 'seven',
        exp: now + 900,
      }),
    ).toThrow(UnauthorizedException);
  });

  it('maps platform claims to a platform actor and verified subject', () => {
    const now = Math.floor(Date.now() / 1000);
    const platformUserId = '00000000-0000-4000-8000-000000000009';
    const user = strategy.validate({
      sub: platformUserId,
      platformUserId,
      isPlatform: true,
      isBootstrap: true,
      exp: now + 900,
    });

    expect(user).toMatchObject({
      subjectId: platformUserId,
      platformUserId,
      isPlatform: true,
      isBootstrap: true,
    });
  });
});
