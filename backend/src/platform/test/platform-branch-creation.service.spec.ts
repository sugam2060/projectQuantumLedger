import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { RedisService } from '../../redis/redis.service';
import { ObjectStoreService } from '../../storage/object-store.service';
import { AuditLogsService } from '../../audit-logs';
import { PlatformBusinessesRepository } from '../platform-businesses.repository';
import { PlatformBusinessesService } from '../platform-businesses.service';
import type { EmailProducer } from '../../jobs/email';

describe('PlatformBusinessesService.createBranch', () => {
  const database = { transactionWithSession: jest.fn() };
  const redis = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    setIfAbsent: jest.fn().mockResolvedValue(true),
    compareAndDelete: jest.fn().mockResolvedValue(true),
  };
  const auditLogs = {
    insertPlatformEvent: jest.fn().mockResolvedValue(undefined),
  };
  const businessId = '00000000-0000-4000-8000-000000000001';
  const platformUserId = '00000000-0000-4000-8000-000000000002';
  let service: PlatformBusinessesService;
  let branchValues: unknown;
  let terminalValues: unknown;
  let terminalRows: Array<{ id: string; name: string; terminalCode: string }>;
  let outboxValues: Array<{
    payload: { template: string; to: string; context: Record<string, unknown> };
  }>;
  let selectCount = 0;

  beforeEach(() => {
    jest.clearAllMocks();
    selectCount = 0;
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValue(undefined);
    redis.setIfAbsent.mockResolvedValue(true);
    redis.compareAndDelete.mockResolvedValue(true);
    auditLogs.insertPlatformEvent.mockResolvedValue(undefined);
    branchValues = undefined;
    terminalValues = undefined;
    terminalRows = [];
    outboxValues = [];

    const tx = {
      select: jest.fn(() => {
        selectCount += 1;
        if (selectCount % 2 === 0) {
          const ownerQuery = {
            from: jest.fn(),
            innerJoin: jest.fn(),
            where: jest
              .fn()
              .mockResolvedValue([{ email: 'owner@example.com' }]),
          };
          ownerQuery.from.mockReturnValue(ownerQuery);
          ownerQuery.innerJoin.mockReturnValue(ownerQuery);
          return ownerQuery;
        }
        const businessQuery = {
          from: jest.fn(),
          where: jest.fn(),
          limit: jest
            .fn()
            .mockResolvedValue([{ id: businessId, displayName: 'Example' }]),
        };
        businessQuery.from.mockReturnValue(businessQuery);
        businessQuery.where.mockReturnValue(businessQuery);
        return businessQuery;
      }),
      insert: jest.fn((_table: unknown) => ({
        values: (values: unknown) => {
          if (Array.isArray(values)) {
            terminalValues = values;
            return { returning: jest.fn().mockResolvedValue(terminalRows) };
          }
          if (branchValues === undefined) branchValues = values;
          return {
            returning: jest
              .fn()
              .mockResolvedValue([{ id: 'branch-id', name: 'Main Branch' }]),
          };
        },
      })),
    };
    database.transactionWithSession.mockImplementation(
      async (_session: unknown, callback: (transaction: unknown) => unknown) =>
        callback(tx),
    );
    service = new PlatformBusinessesService(
      new PlatformBusinessesRepository(database as unknown as DatabaseService),
      redis as unknown as RedisService,
      auditLogs as unknown as AuditLogsService,
      {
        send: jest.fn((job: (typeof outboxValues)[number]['payload']) => {
          outboxValues.push({ payload: job });
          return Promise.resolve();
        }),
      } as unknown as EmailProducer,
    );
  });

  it('creates one default terminal when names are omitted', async () => {
    terminalRows = [
      {
        id: 'terminal-id',
        name: 'Initial Terminal',
        terminalCode: 'POS-A1B2C3D4E5F60718',
      },
    ];
    await expect(
      service.createBranch(
        businessId,
        { name: ' Main Branch ', code: ' main ' },
        'key-1',
        platformUserId,
      ),
    ).resolves.toEqual({
      branch: { id: 'branch-id', name: 'Main Branch' },
      terminals: terminalRows,
    });
    expect(branchValues).toMatchObject({
      businessId,
      name: 'Main Branch',
      code: 'MAIN',
      address: null,
      contactNumber: null,
    });
    expect(terminalValues).toEqual([
      {
        businessId,
        branchId: 'branch-id',
        name: 'Initial Terminal',
        terminalCode: expect.stringMatching(/^POS-[A-F0-9]{16}$/),
        status: 'inactive',
      },
    ]);
    expect(outboxValues).toHaveLength(1);
    expect(outboxValues[0]).toMatchObject({
      payload: {
        template: 'branch-created',
        to: 'owner@example.com',
        context: {
          businessName: 'Example',
          businessId,
          branchName: 'Main Branch',
          branchId: 'branch-id',
          terminals: [
            {
              name: 'Initial Terminal',
              terminalCode: expect.stringMatching(/^POS-[A-F0-9]{16}$/),
            },
          ],
        },
      },
    });
    expect(auditLogs.insertPlatformEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        platformUserId,
        businessId,
        action: 'branch.created',
        responseStatus: 201,
      }),
    );
  });

  it('creates all requested terminals with unique activation codes and inactive status', async () => {
    terminalRows = [
      { id: 't1', name: 'Counter One', terminalCode: 'POS-01' },
      { id: 't2', name: 'Counter Two', terminalCode: 'POS-02' },
    ];
    await service.createBranch(
      businessId,
      {
        name: 'Main Branch',
        code: 'MAIN',
        terminals: [{ name: 'Counter One' }, { name: 'Counter Two' }],
      },
      'key-2',
      platformUserId,
    );
    expect(terminalValues).toEqual([
      expect.objectContaining({
        name: 'Counter One',
        status: 'inactive',
        terminalCode: expect.stringMatching(/^POS-[A-F0-9]{16}$/),
      }),
      expect.objectContaining({
        name: 'Counter Two',
        status: 'inactive',
        terminalCode: expect.stringMatching(/^POS-[A-F0-9]{16}$/),
      }),
    ]);
    expect(
      new Set(
        (terminalValues as Array<{ terminalCode: string }>).map(
          (item) => item.terminalCode,
        ),
      ).size,
    ).toBe(2);
  });

  it('replays the stored response for a repeated idempotency key', async () => {
    terminalRows = [
      { id: 'terminal-id', name: 'Initial Terminal', terminalCode: 'POS-01' },
    ];
    const input = { name: 'Main Branch', code: 'MAIN' };
    const first = await service.createBranch(
      businessId,
      input,
      'same-key',
      platformUserId,
    );
    redis.get.mockResolvedValue(redis.set.mock.calls[0]?.[1] as string);
    await expect(
      service.createBranch(businessId, input, 'same-key', platformUserId),
    ).resolves.toEqual(first);
    expect(database.transactionWithSession).toHaveBeenCalledTimes(1);
  });

  it('rejects a reused key with a different payload', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({ requestHash: 'other-payload', response: {} }),
    );
    await expect(
      service.createBranch(
        businessId,
        { name: 'Main Branch', code: 'MAIN' },
        'same-key',
        platformUserId,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(database.transactionWithSession).not.toHaveBeenCalled();
  });

  it('returns not found when the business does not exist', async () => {
    database.transactionWithSession.mockImplementationOnce(
      async (_session: unknown, callback: (transaction: unknown) => unknown) =>
        callback({
          select: jest.fn(() => ({
            from: jest.fn(() => ({
              where: jest.fn(() => ({
                limit: jest.fn().mockResolvedValue([]),
              })),
            })),
          })),
        }),
    );
    await expect(
      service.createBranch(
        businessId,
        { name: 'Main Branch', code: 'MAIN' },
        'key-3',
        platformUserId,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('maps a duplicate branch-code database conflict to 409', async () => {
    database.transactionWithSession.mockRejectedValueOnce({ code: '23505' });
    await expect(
      service.createBranch(
        businessId,
        { name: 'Main Branch', code: 'MAIN' },
        'key-4',
        platformUserId,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('fails the operation when the required audit insert fails', async () => {
    terminalRows = [
      { id: 'terminal-id', name: 'Initial Terminal', terminalCode: 'POS-01' },
    ];
    auditLogs.insertPlatformEvent.mockRejectedValueOnce(
      new Error('audit unavailable'),
    );
    await expect(
      service.createBranch(
        businessId,
        { name: 'Main Branch', code: 'MAIN' },
        'key-5',
        platformUserId,
      ),
    ).rejects.toThrow('Branch creation is temporarily unavailable');
    expect(auditLogs.insertPlatformEvent).toHaveBeenCalledTimes(1);
    expect(redis.set).not.toHaveBeenCalled();
  });
});
