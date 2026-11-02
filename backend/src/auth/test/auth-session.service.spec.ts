import { Test, TestingModule } from '@nestjs/testing';
import { RedisService } from '../../redis/redis.service';
import {
  AuthSessionService,
  AuthSessionRecord,
} from '../auth-session.service';

describe('AuthSessionService', () => {
  let service: AuthSessionService;
  const redis = {
    client: {
      set: jest.fn(),
      get: jest.fn(),
      eval: jest.fn(),
      exists: jest.fn(),
      del: jest.fn(),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthSessionService,
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = module.get<AuthSessionService>(AuthSessionService);
  });

  it('stores the session with the 48-hour refresh lifetime', async () => {
    await service.create('session-id', session);

    expect(redis.client.set).toHaveBeenCalledWith(
      'auth:session:session-id',
      JSON.stringify(session),
      'EX',
      172800,
      'NX',
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

    expect(redis.client.del).toHaveBeenCalledWith('auth:session:session-id');
  });
});
