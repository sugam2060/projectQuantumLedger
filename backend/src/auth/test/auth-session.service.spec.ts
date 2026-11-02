import { Test, TestingModule } from '@nestjs/testing';
import { RedisService } from '../../redis/redis.service';
import { AuthSessionService, AuthSessionRecord } from '../auth-session.service';

describe('AuthSessionService', () => {
  let service: AuthSessionService;
  const redis = {
    client: {
      set: jest.fn(),
      get: jest.fn(),
      eval: jest.fn(),
      exists: jest.fn(),
      del: jest.fn(),
      scan: jest.fn(),
      mget: jest.fn(),
      sadd: jest.fn(),
    },
  };
  const session: AuthSessionRecord = {
    userId: '98b336f3-4481-4c90-a26a-388ae29ff607',
    clientType: 'desktop',
    refreshTokenHash: 'hashed-refresh-secret',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    redis.client.set.mockResolvedValue('OK');
    redis.client.get.mockResolvedValue(JSON.stringify(session));
    redis.client.eval.mockResolvedValue(1);
    redis.client.exists.mockResolvedValue(1);
    redis.client.del.mockResolvedValue(1);
    redis.client.scan.mockResolvedValue(['0', []]);
    redis.client.mget.mockResolvedValue([]);
    redis.client.sadd.mockResolvedValue(1);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthSessionService,
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = module.get<AuthSessionService>(AuthSessionService);
  });

  it('atomically stores the session and indexes it for its user', async () => {
    await service.create('session-id', session);

    expect(redis.client.eval).toHaveBeenCalledWith(
      expect.stringContaining('SADD'),
      2,
      'auth:session:session-id',
      `auth:user-sessions:${session.userId}`,
      JSON.stringify(session),
      'session-id',
      172800,
    );
  });

  it('rotates a refresh secret atomically and invalidates a reused secret', async () => {
    await expect(
      service.rotate('session-id', 'old-hash', 'new-hash'),
    ).resolves.toBe(true);

    expect(redis.client.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'auth:session:session-id',
      'old-hash',
      'new-hash',
      172800,
    );

    redis.client.eval.mockResolvedValueOnce(0);
    await expect(
      service.rotate('session-id', 'old-hash', 'replayed-hash'),
    ).resolves.toBe(false);
  });

  it('reads and revokes sessions for access-token validation and logout', async () => {
    await expect(service.get('session-id')).resolves.toEqual(session);
    await expect(service.isActive('session-id')).resolves.toBe(true);
    await service.revoke('session-id');

    expect(redis.client.eval).toHaveBeenLastCalledWith(
      expect.stringContaining('SREM'),
      1,
      'auth:session:session-id',
      'session-id',
    );
  });

  it('indexes legacy sessions and revokes every session for the user', async () => {
    redis.client.scan.mockResolvedValue(['0', ['auth:session:legacy-session']]);
    redis.client.mget.mockResolvedValue([
      JSON.stringify({ ...session, refreshTokenHash: 'legacy-hash' }),
    ]);

    await service.revokeAll(session.userId);

    expect(redis.client.scan).toHaveBeenCalledWith(
      '0',
      'MATCH',
      'auth:session:*',
      'COUNT',
      100,
    );
    expect(redis.client.sadd).toHaveBeenCalledWith(
      `auth:user-sessions:${session.userId}`,
      'legacy-session',
    );
    expect(redis.client.eval).toHaveBeenLastCalledWith(
      expect.stringContaining('SMEMBERS'),
      1,
      `auth:user-sessions:${session.userId}`,
    );

    redis.client.eval.mockResolvedValueOnce(0);
    await expect(service.revokeAll(session.userId)).resolves.toBeUndefined();
  });
});
