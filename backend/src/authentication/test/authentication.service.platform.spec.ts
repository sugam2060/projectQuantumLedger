import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '../../database/database.service';
import { RedisService } from '../../redis/redis.service';
import { UtilsService } from '../../utils/utils.service';
import { PlatformAuthService } from '../authentication.service.platform';
import { PlatformUserLoginDto } from '../dto/platform-user-login.dto';
import bcrypt from 'bcryptjs';

describe('PlatformAuthService', () => {
  const database = {
    transactionWithSession: jest.fn(),
  };
  const jwt = { signAsync: jest.fn() };
  const utils = { generateRefreshToken: jest.fn() };
  const redis = { set: jest.fn(), get: jest.fn(), delete: jest.fn() };
  let service: PlatformAuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PlatformAuthService(
      database as unknown as DatabaseService,
      jwt as unknown as JwtService,
      utils as unknown as UtilsService,
      redis as unknown as RedisService,
    );
  });

  const mockCredentialLookup = (credential: object) => {
    const query = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([credential]),
    };
    const transaction = { select: jest.fn().mockReturnValue(query) };
    database.transactionWithSession.mockImplementation(
      async (_session, callback) => callback(transaction),
    );
    return { query, transaction };
  };

  it('returns platform identity and rotates a namespaced refresh token', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 4);
    const { query, transaction } = mockCredentialLookup({
      id: '00000000-0000-4000-8000-000000000001',
      passwordHash,
      name: 'Platform Manager',
      status: 'active',
      isBootstrap: true,
    });
    jwt.signAsync.mockResolvedValue('platform-access-token');
    utils.generateRefreshToken.mockReturnValue('platform-refresh-token');

    const result = await service.login({
      email: ' PlatformManager@example.com ',
      password: 'correct-password',
    } satisfies PlatformUserLoginDto);

    expect(database.transactionWithSession).toHaveBeenCalledWith(
      { platformAuthEmail: 'platformmanager@example.com' },
      expect.any(Function),
    );
    expect(transaction.select).toHaveBeenCalledTimes(1);
    expect(query.where).toHaveBeenCalledTimes(1);
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: '00000000-0000-4000-8000-000000000001',
        platformUserId: '00000000-0000-4000-8000-000000000001',
        isPlatform: true,
        isBootstrap: true,
      }),
      expect.objectContaining({ expiresIn: 900 }),
    );
    expect(redis.set).toHaveBeenCalledWith(
      'platform_refresh_token:platform-refresh-token',
      '00000000-0000-4000-8000-000000000001',
      7 * 24 * 60 * 60,
    );
    expect(result).toEqual({
      accessToken: 'platform-access-token',
      refreshToken: 'platform-refresh-token',
      tokenType: 'Bearer',
      expiresIn: 900,
      user: {
        id: '00000000-0000-4000-8000-000000000001',
        displayName: 'Platform Manager',
      },
      isPlatform: true,
      isBootstrap: true,
    });
  });

  it('rejects unknown or inactive platform users with a generic error', async () => {
    mockCredentialLookup({
      id: '00000000-0000-4000-8000-000000000001',
      passwordHash: 'hash',
      name: 'Platform Manager',
      status: 'disabled',
      isBootstrap: false,
    });

    await expect(
      service.login({ email: 'manager@example.com', password: 'password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects invalid refresh tokens', async () => {
    redis.get.mockResolvedValue(null);

    await expect(service.refresh('invalid-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('refreshes only an active platform user and rotates the old token', async () => {
    redis.get.mockResolvedValue('00000000-0000-4000-8000-000000000001');
    const query = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([
        {
          id: '00000000-0000-4000-8000-000000000001',
          name: 'Platform Manager',
          status: 'active',
          isBootstrap: true,
        },
      ]),
    };
    const transaction = { select: jest.fn().mockReturnValue(query) };
    database.transactionWithSession.mockImplementation(
      async (_session, callback) => callback(transaction),
    );
    jwt.signAsync.mockResolvedValue('refreshed-access-token');
    utils.generateRefreshToken.mockReturnValue('new-platform-refresh-token');

    const result = await service.refresh('old-platform-refresh-token');

    expect(database.transactionWithSession).toHaveBeenCalledWith(
      {
        isPlatform: true,
        platformUserId: '00000000-0000-4000-8000-000000000001',
      },
      expect.any(Function),
    );
    expect(redis.set).toHaveBeenCalledWith(
      'platform_refresh_token:new-platform-refresh-token',
      '00000000-0000-4000-8000-000000000001',
      7 * 24 * 60 * 60,
    );
    expect(redis.delete).toHaveBeenCalledWith(
      'platform_refresh_token:old-platform-refresh-token',
    );
    expect(result.isPlatform).toBe(true);
    expect(result.isBootstrap).toBe(true);
  });
});
