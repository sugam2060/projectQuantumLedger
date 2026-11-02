import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../../database/database.service';
import { AuthSessionService } from '../auth-session.service';
import { AuthService } from '../auth.service';

const mockCompare = jest.fn<Promise<boolean>, [string, string]>();
jest.mock('bcrypt', () => ({
  compare: (password: string, hash: string) => mockCompare(password, hash),
}));

describe('AuthService', () => {
  let service: AuthService;
  const compareMock = mockCompare;
  const user = {
    id: '98b336f3-4481-4c90-a26a-388ae29ff607',
    email: 'person@example.com',
    passwordHash: 'stored-hash',
    displayName: 'Test User',
    status: 'active',
  };
  const database = {
    db: {
      transaction: jest.fn(),
    },
  };
  const jwtService = {
    signAsync: jest.fn(),
  };
  const authSessionService = {
    create: jest.fn(),
    get: jest.fn(),
    rotate: jest.fn(),
    isActive: jest.fn(),
    revoke: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    compareMock.mockResolvedValue(true);
    database.db.transaction.mockImplementation(
      async (
        callback: (
          transaction: ReturnType<typeof createTransaction>,
        ) => Promise<unknown>,
      ) => callback(createTransaction([[user], [], []])),
    );
    jwtService.signAsync.mockResolvedValue('signed-access-token');
    authSessionService.create.mockResolvedValue(undefined);
    authSessionService.get.mockResolvedValue(null);
    authSessionService.rotate.mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: DatabaseService, useValue: database },
        { provide: JwtService, useValue: jwtService },
        { provide: AuthSessionService, useValue: authSessionService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('returns 15-minute JWT and a hashed, session-backed refresh token', async () => {
    const queryResults = [
      [[user]],
      [
        [user],
        [
          {
            membershipId: 'membership-one',
            businessId: 'business-one',
          },
        ],
        [
          {
            membershipId: 'membership-one',
            branchId: 'branch-one',
          },
        ],
        [
          {
            membershipId: 'membership-one',
            branchId: 'branch-one',
            roleCode: 'manager',
            permissionCode: 'sales.read',
          },
        ],
      ],
    ];
    database.db.transaction.mockImplementation(
      async (
        callback: (
          transaction: ReturnType<typeof createTransaction>,
        ) => Promise<unknown>,
      ) => callback(createTransaction(queryResults.shift() ?? [])),
    );

    const response = await service.login(
      {
        email: user.email,
        password: 'correct-password',
        deviceLabel: 'POS-01',
      },
      { clientType: 'desktop' },
    );

    expect(response).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 900,
      user: { id: user.id, email: user.email },
      memberships: [{ businessId: 'business-one', branchIds: ['branch-one'] }],
    });
    expect(response.accessToken).toBe('signed-access-token');
    const refreshBytes = Buffer.from(response.refreshToken, 'base64url');
    const sessionId = refreshBytes.subarray(0, 16).toString('base64url');
    const refreshSecret = refreshBytes.subarray(16).toString('base64url');
    expect(sessionId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(response.refreshToken).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(refreshSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authSessionService.create).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({
        userId: user.id,
        clientType: 'desktop',
        deviceLabel: 'POS-01',
        refreshTokenHash: createHash('sha256')
          .update(refreshSecret)
          .digest('base64url'),
      }),
    );
    expect(jwtService.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: user.id,
        jti: sessionId,
        roles: ['manager'],
        permissions: ['sales.read'],
      }),
    );
  });

  it('uses the same unauthorized response for unknown users and wrong passwords', async () => {
    database.db.transaction.mockImplementationOnce(
      async (
        callback: (
          transaction: ReturnType<typeof createTransaction>,
        ) => Promise<unknown>,
      ) => callback(createTransaction([[]])),
    );

    await expect(
      service.login(
        { email: user.email, password: 'wrong-password' },
        { clientType: 'desktop' },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(compareMock).toHaveBeenCalled();

    compareMock.mockResolvedValueOnce(false);
    await expect(
      service.login(
        { email: user.email, password: 'wrong-password' },
        { clientType: 'desktop' },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects refresh-token replay after atomic rotation', async () => {
    const refreshToken = Buffer.concat([
      Buffer.alloc(16, 97),
      Buffer.alloc(32, 98),
    ]).toString('base64url');
    const refreshSecret = Buffer.from(refreshToken, 'base64url')
      .subarray(16)
      .toString('base64url');
    authSessionService.get.mockResolvedValue({
      userId: user.id,
      clientType: 'desktop',
      refreshTokenHash: createHash('sha256')
        .update(refreshSecret)
        .digest('base64url'),
    });
    authSessionService.rotate.mockResolvedValue(false);

    await expect(
      service.refresh(refreshToken, { clientType: 'desktop' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

function createTransaction(queryResults: unknown[][]) {
  const results = [...queryResults];
  return {
    execute: jest.fn().mockResolvedValue(undefined),
    select: jest.fn(() => createQuery(results.shift() ?? [])),
  };
}

function createQuery(result: unknown[]) {
  const query = Object.assign(Promise.resolve(result), {
    from: jest.fn(),
    innerJoin: jest.fn(),
    leftJoin: jest.fn(),
    where: jest.fn(),
    limit: jest.fn(),
  });

  query.from.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  query.leftJoin.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.limit.mockResolvedValue(result);
  return query;
}
