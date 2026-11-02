import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthModule } from '../src/auth/auth.module';
import { DatabaseService } from '../src/database/database.service';
import { RedisService } from '../src/redis/redis.service';

const mockCompare = jest.fn<Promise<boolean>, [string, string]>();
jest.mock('bcrypt', () => ({
  compare: (password: string, hash: string) => mockCompare(password, hash),
}));

describe('Authentication (e2e)', () => {
  let app: INestApplication<App>;
  const compareMock = mockCompare;
  const user = {
    id: '98b336f3-4481-4c90-a26a-388ae29ff607',
    email: 'person@example.com',
    passwordHash: 'stored-hash',
    status: 'active',
  };
  const membershipRows = [
    { membershipId: 'membership-one', businessId: 'business-one' },
  ];
  const branchRows = [
    { membershipId: 'membership-one', branchId: 'branch-one' },
  ];
  const roleRows = [
    {
      membershipId: 'membership-one',
      branchId: 'branch-one',
      roleCode: 'manager',
      permissionCode: 'sales.read',
    },
  ];
  const database = {
    db: {
      transaction: jest.fn(),
      insert: jest.fn(),
    },
  };
  const auditValues = jest.fn();
  const redisState = new Map<string, string>();
  const sessionIndexes = new Map<string, Set<string>>();
  const rateAttempts = new Map<string, number[]>();
  const redis = {
    client: {
      set: jest.fn(
        async (
          key: string,
          value: string,
          _expiryMode: string,
          _ttl: number,
          _existenceMode: string,
        ) => {
          if (redisState.has(key)) {
            return null;
          }
          redisState.set(key, value);
          return 'OK';
        },
      ),
      get: jest.fn(async (key: string) => redisState.get(key) ?? null),
      exists: jest.fn(async (key: string) => Number(redisState.has(key))),
      del: jest.fn(async (key: string) => Number(redisState.delete(key))),
      scan: jest.fn(async () => ['0', []]),
      mget: jest.fn(async (...keys: string[]) =>
        keys.map((key) => redisState.get(key) ?? null),
      ),
      sadd: jest.fn(async (key: string, ...members: string[]) => {
        const index = sessionIndexes.get(key) ?? new Set<string>();
        const previousSize = index.size;
        members.forEach((member) => index.add(member));
        sessionIndexes.set(key, index);
        return index.size - previousSize;
      }),
      eval: jest.fn(
        async (
          script: string,
          _numberOfKeys: number,
          key: string,
          ...arguments_: Array<string | number>
        ) => {
          if (script.includes('ZREMRANGEBYSCORE')) {
            const now = Number(arguments_[0]);
            const windowMilliseconds = Number(arguments_[1]);
            const limit = Number(arguments_[2]);
            const activeAttempts = (rateAttempts.get(key) ?? [])
              .filter((timestamp) => timestamp > now - windowMilliseconds)
              .sort((left, right) => left - right);

            if (activeAttempts.length >= limit) {
              return [
                0,
                Math.max(1, activeAttempts[0] + windowMilliseconds - now),
              ];
            }

            activeAttempts.push(now);
            rateAttempts.set(key, activeAttempts);
            return [1, 0];
          }

          if (script.includes('SMEMBERS')) {
            const sessions = sessionIndexes.get(key) ?? new Set<string>();
            for (const sessionId of sessions) {
              redisState.delete(`auth:session:${sessionId}`);
            }
            sessionIndexes.delete(key);
            return sessions.size;
          }

          if (script.includes('SREM')) {
            const serialized = redisState.get(key);
            if (serialized) {
              const session = JSON.parse(serialized) as { userId: string };
              sessionIndexes
                .get(`auth:user-sessions:${session.userId}`)
                ?.delete(String(arguments_[0]));
            }
            return Number(redisState.delete(key));
          }

          if (script.includes("'NX'")) {
            const indexKey = String(arguments_[0]);
            const serialized = String(arguments_[1]);
            const sessionId = String(arguments_[2]);
            if (redisState.has(key)) {
              return 0;
            }
            redisState.set(key, serialized);
            const index = sessionIndexes.get(indexKey) ?? new Set<string>();
            index.add(sessionId);
            sessionIndexes.set(indexKey, index);
            return 1;
          }

          const serialized = redisState.get(key);
          if (!serialized) {
            return 0;
          }
          const session = JSON.parse(serialized) as {
            refreshTokenHash: string;
          };
          const firstArgument = arguments_[0];
          if (
            typeof firstArgument !== 'string' ||
            session.refreshTokenHash !== firstArgument
          ) {
            return 0;
          }
          session.refreshTokenHash = String(arguments_[1]);
          redisState.set(key, JSON.stringify(session));
          const indexKey = `auth:user-sessions:${session.userId}`;
          const sessionId = key.slice('auth:session:'.length);
          const index = sessionIndexes.get(indexKey) ?? new Set<string>();
          index.add(sessionId);
          sessionIndexes.set(indexKey, index);
          return 1;
        },
      ),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    redisState.clear();
    sessionIndexes.clear();
    rateAttempts.clear();
    database.db.insert.mockReturnValue({ values: auditValues });
    auditValues.mockResolvedValue(undefined);
    compareMock.mockResolvedValue(true);
    database.db.transaction.mockImplementation(
      async (
        callback: (
          transaction: ReturnType<typeof createTransaction>,
        ) => Promise<unknown>,
      ) =>
        callback(
          createTransaction([user], membershipRows, branchRows, roleRows),
        ),
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              DATABASE_URL: 'postgres://test:test@localhost:5432/test',
              JWT_SECRET: 'test-secret-with-sufficient-length',
              NODE_ENV: 'test',
            }),
          ],
        }),
        AuthModule,
      ],
    })
      .overrideProvider(DatabaseService)
      .useValue(database)
      .overrideProvider(RedisService)
      .useValue(redis)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('/api/v1');
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('issues a JWT and rotating refresh token with membership claims', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('x-client-type', 'desktop')
      .send({
        email: user.email,
        password: 'correct-password',
        deviceLabel: 'POS-01',
      })
      .expect(200);

    expect(login.body).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 900,
      user: { id: user.id, email: user.email },
      memberships: [{ businessId: 'business-one', branchIds: ['branch-one'] }],
    });
    expect(login.body.accessToken).toEqual(expect.any(String));
    expect(login.body.refreshToken).toMatch(/^[A-Za-z0-9_-]{64}$/);

    await request(app.getHttpServer())
      .get('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200)
      .expect({ userId: user.id, email: user.email });

    const refresh = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('x-client-type', 'desktop')
      .send({ refreshToken: login.body.refreshToken })
      .expect(200);

    expect(refresh.body.accessToken).toEqual(expect.any(String));
    expect(refresh.body.refreshToken).not.toBe(login.body.refreshToken);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('x-client-type', 'desktop')
      .send({ refreshToken: login.body.refreshToken })
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${refresh.body.accessToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .get('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${refresh.body.accessToken}`)
      .expect(401);
  });

  it('returns token metadata to web clients', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('x-client-type', 'web')
      .send({ email: user.email, password: 'correct-password' })
      .expect(200);

    expect(login.body).toEqual({
      tokenType: 'Bearer',
      expiresIn: 900,
      user: { id: user.id, email: user.email },
      memberships: [{ businessId: 'business-one', branchIds: ['branch-one'] }],
    });
  });

  it('requires a client type and revokes every session for the authenticated user', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('x-client-type', 'desktop')
      .send({ email: user.email, password: 'correct-password' })
      .expect(200);
    const secondLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('x-client-type', 'mobile')
      .send({ email: user.email, password: 'correct-password' })
      .expect(200);
    expect(secondLogin.body.accessToken).toEqual(expect.any(String));

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ reason: 'Lost device' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .set('x-client-type', 'desktop')
      .send({ reason: 'Lost device' })
      .expect(200)
      .expect({ revoked: true });

    expect(
      [...redisState.keys()].filter((key) => key.startsWith('auth:session:')),
    ).toHaveLength(0);
    expect(auditValues).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: user.id,
        targetUserId: user.id,
        action: 'auth.logout_all',
        reason: 'Lost device',
      }),
    );

    await request(app.getHttpServer())
      .get('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(401);
  });

  it('sets only http-only cookies for web clients', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('x-client-type', 'web')
      .send({ email: user.email, password: 'correct-password' })
      .expect(200);
    const setCookies = [login.headers['set-cookie']].flat();
    expect(setCookies).toHaveLength(2);
    expect(setCookies.join(';')).toContain('HttpOnly');
    expect(setCookies.join(';')).toContain('SameSite=Strict');
    expect(setCookies.join(';')).toContain('access_token=');
    expect(setCookies.join(';')).toContain('refresh_token=');

    const refreshCookie = setCookies
      .find((cookie: string) => cookie.startsWith('refresh_token='))
      ?.split(';')[0];
    const accessCookie = setCookies
      .find((cookie: string) => cookie.startsWith('access_token='))
      ?.split(';')[0];
    expect(refreshCookie).toBeDefined();
    expect(accessCookie).toBeDefined();

    await request(app.getHttpServer())
      .get('/api/v1/auth/profile')
      .set('Cookie', accessCookie ?? '')
      .expect(200)
      .expect({ userId: user.id, email: user.email });

    const refresh = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('x-client-type', 'web')
      .set('Cookie', refreshCookie ?? '')
      .send({})
      .expect(200);

    expect(refresh.body).not.toHaveProperty('accessToken');
    expect(refresh.body).not.toHaveProperty('refreshToken');
    expect([refresh.headers['set-cookie']].flat()).toHaveLength(2);
  });

  it('rejects invalid client type and malformed login input', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('x-client-type', 'server')
      .send({ email: user.email, password: 'correct-password' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('x-client-type', 'mobile')
      .send({ email: 'not-an-email', password: '' })
      .expect(400);
  });

  it('returns a generic 401 for incorrect credentials', async () => {
    compareMock.mockResolvedValueOnce(false);

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('x-client-type', 'desktop')
      .send({ email: user.email, password: 'wrong-password' })
      .expect(401)
      .expect((response) => {
        expect(response.body).toMatchObject({
          statusCode: 401,
          message: 'Invalid email or password',
        });
      });
  });

  it('returns 429 after the shared per-IP login rate limit', async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('x-client-type', 'mobile')
        .send({ email: 'not-an-email', password: '' })
        .expect(400);
    }

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('x-client-type', 'mobile')
      .send({ email: 'not-an-email', password: '' })
      .expect(429)
      .expect((response) => {
        const retryAfter = Number(response.headers['retry-after']);
        expect(retryAfter).toBeGreaterThan(0);
        expect(retryAfter).toBeLessThanOrEqual(60);
      });
  });
});

function createTransaction(
  userRows: unknown[],
  memberships: unknown[],
  branches: unknown[],
  roles: unknown[],
) {
  const results = [userRows, memberships, branches, roles];
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
