import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { createHash } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { RedisService } from '../../redis/redis.service';
import { PlatformUserInvitationsService } from '../platform-user-invitations.service';

describe('PlatformUserInvitationsService', () => {
  const database = { transactionWithSession: jest.fn() };
  const redis = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    setIfAbsent: jest.fn().mockResolvedValue(true),
    compareAndDelete: jest.fn().mockResolvedValue(true),
  };
  const config: { frontendBaseUrl: string | undefined } = {
    frontendBaseUrl: 'https://frontend.example/',
  };
  const outboxPublisher = { notifyOutboxAvailable: jest.fn() };
  let service: PlatformUserInvitationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    redis.get.mockResolvedValue(null);
    redis.setIfAbsent.mockResolvedValue(true);
    redis.set.mockResolvedValue(undefined);
    redis.compareAndDelete.mockResolvedValue(true);
    config.frontendBaseUrl = 'https://frontend.example/';
    database.transactionWithSession.mockImplementation(
      async (_session: unknown, callback: (transaction: unknown) => unknown) =>
        callback({
          select: jest.fn(() => ({
            from: jest.fn(() => ({
              where: jest.fn(() => ({
                limit: jest.fn().mockResolvedValue([]),
              })),
            })),
          })),
          insert: jest.fn(() => ({
            values: jest.fn().mockResolvedValue(undefined),
          })),
        }),
    );
    service = new PlatformUserInvitationsService(
      database as unknown as DatabaseService,
      redis as unknown as RedisService,
      config as never,
      outboxPublisher as never,
    );
  });

  it('stores a platform invitation and queues its magic-link email atomically', async () => {
    const inserted: Array<{ table: unknown; values: unknown }> = [];
    database.transactionWithSession.mockImplementation(
      async (_session: unknown, callback: (transaction: unknown) => unknown) =>
        callback({
          select: jest.fn(() => ({
            from: jest.fn(() => ({
              where: jest.fn(() => ({
                limit: jest.fn().mockResolvedValue([]),
              })),
            })),
          })),
          insert: jest.fn((table: unknown) => ({
            values: jest.fn((values: unknown) => {
              inserted.push({ table, values });
              return Promise.resolve(undefined);
            }),
          })),
        }),
    );

    await expect(
      service.invitePlatformUser(
        { name: 'Jane Manager', email: ' JANE@EXAMPLE.COM ' },
        'key-1',
        'platform-user-id',
        'Admin',
      ),
    ).resolves.toEqual({ message: 'Invite sent to Jane Manager' });

    expect(database.transactionWithSession).toHaveBeenCalledWith(
      expect.objectContaining({
        isPlatform: true,
        platformUserId: 'platform-user-id',
      }),
      expect.any(Function),
    );
    expect(inserted).toHaveLength(2);
    expect(inserted[0].values).toMatchObject({
      emailNormalized: 'jane@example.com',
      inviteeName: 'Jane Manager',
      invitationType: 'platform_user',
      invitedByPlatformUserId: 'platform-user-id',
    });
    const invitation = inserted[0].values as {
      tokenHash: string;
      expiresAt: Date;
    };
    const mailJob = inserted[1].values as {
      payload: { context: Record<string, unknown> };
      businessId: null;
      requestId: null;
    };
    expect(mailJob).toMatchObject({
      businessId: null,
      requestId: null,
      payload: {
        to: 'jane@example.com',
        template: 'user-invitation',
        context: {
          inviterName: 'Admin',
          invitationUrl: `https://frontend.example/accept/invite/${invitation.tokenHash}`,
        },
      },
    });
    expect(invitation.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(invitation.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(outboxPublisher.notifyOutboxAvailable).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining(':result'),
      expect.stringContaining('requestHash'),
      7 * 24 * 60 * 60,
    );
  });

  it('replays the original response for the same idempotency key and payload', async () => {
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          email: 'jane@example.com',
          name: 'Jane Manager',
        }),
      )
      .digest('hex');
    redis.get.mockResolvedValue(
      JSON.stringify({
        requestHash,
        response: { message: 'Invite sent to Jane Manager' },
      }),
    );

    await expect(
      service.invitePlatformUser(
        { name: 'Jane Manager', email: 'jane@example.com' },
        'same-key',
        'platform-user-id',
        'Admin',
      ),
    ).resolves.toEqual({ message: 'Invite sent to Jane Manager' });
    expect(database.transactionWithSession).not.toHaveBeenCalled();
  });

  it('rejects when the email already belongs to a platform user', async () => {
    database.transactionWithSession.mockImplementation(
      async (_session: unknown, callback: (transaction: unknown) => unknown) =>
        callback({
          select: jest.fn(() => ({
            from: jest.fn(() => ({
              where: jest.fn(() => ({
                limit: jest.fn().mockResolvedValue([{ id: 'existing-id' }]),
              })),
            })),
          })),
          insert: jest.fn(),
        }),
    );

    await expect(
      service.invitePlatformUser(
        { name: 'Jane Manager', email: 'jane@example.com' },
        'key-1',
        'platform-user-id',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(redis.compareAndDelete).toHaveBeenCalledTimes(1);
  });
});
