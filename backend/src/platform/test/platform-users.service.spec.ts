import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { RedisService } from '../../redis/redis.service';
import { PlatformUsersRepository } from '../platform-users.repository';
import { PlatformUsersService } from '../platform-users.service';

describe('PlatformUsersService', () => {
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
  const emailProducer = { send: jest.fn().mockResolvedValue(undefined) };
  const passwords = { hash: jest.fn().mockResolvedValue('argon-hash') };
  let service: PlatformUsersService;

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
          execute: jest.fn().mockResolvedValue({ rows: [{ in_use: false }] }),
          insert: jest.fn(() => ({
            values: jest.fn().mockResolvedValue(undefined),
          })),
        }),
    );
    service = new PlatformUsersService(
      new PlatformUsersRepository(database as unknown as DatabaseService),
      redis as unknown as RedisService,
      config as never,
      emailProducer as never,
      passwords as never,
    );
  });

  it('stores a platform invitation and queues its magic-link email atomically', async () => {
    const inserted: Array<{ table: unknown; values: unknown }> = [];
    database.transactionWithSession.mockImplementation(
      async (_session: unknown, callback: (transaction: unknown) => unknown) =>
        callback({
          execute: jest.fn().mockResolvedValue({ rows: [{ in_use: false }] }),
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
      { platformUserId: 'platform-user-id' },
      expect.any(Function),
    );
    expect(inserted).toHaveLength(1);
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
    const job = emailProducer.send.mock.calls[0][0] as {
      to: string;
      template: string;
      context: { inviterName: string; invitationUrl: string };
    };
    expect(job).toMatchObject({
      to: 'jane@example.com',
      template: 'user-invitation',
      context: { inviterName: 'Admin' },
    });
    // The link carries a random token; only its SHA-256 is stored (never the
    // stored value itself, which would let a database reader accept invites).
    const url = new URL(job.context.invitationUrl);
    expect(url.origin + url.pathname).toBe(
      'https://frontend.example/platform/accept-invite',
    );
    const token = url.searchParams.get('token') ?? '';
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(invitation.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(invitation.tokenHash).not.toBe(token);
    expect(createHash('sha256').update(token).digest('hex')).toBe(
      invitation.tokenHash,
    );
    expect(inserted[0].values).toMatchObject({ platformRole: 'support' });
    expect(invitation.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(emailProducer.send).toHaveBeenCalledTimes(1);
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
          role: 'support',
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
          execute: jest.fn().mockResolvedValue({ rows: [{ in_use: true }] }),
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

  it('accepts a staff invitation with the hash of the emailed token', async () => {
    const execute = jest.fn().mockResolvedValue({
      rows: [{ outcome: 'accepted', platform_user_id: 'new-staff' }],
    });
    database.transactionWithSession.mockImplementation(
      async (_session: unknown, callback: (transaction: unknown) => unknown) =>
        callback({ execute }),
    );
    await expect(
      service.acceptInvitation('t'.repeat(43), 'Strong-Password-1'),
    ).resolves.toEqual({ platformUserId: 'new-staff' });
    expect(passwords.hash).toHaveBeenCalledWith('Strong-Password-1');
  });

  it('answers one generic 400 when the invitation cannot be used', async () => {
    database.transactionWithSession.mockImplementation(
      async (_session: unknown, callback: (transaction: unknown) => unknown) =>
        callback({
          execute: jest.fn().mockResolvedValue({
            rows: [{ outcome: 'invalid', platform_user_id: null }],
          }),
        }),
    );
    await expect(
      service.acceptInvitation('t'.repeat(43), 'Strong-Password-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
