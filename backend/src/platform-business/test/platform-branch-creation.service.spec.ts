import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { RedisService } from '../../redis/redis.service';
import { ObjectStoreService } from '../../utils/objectStore.service';
import { AuditLogService } from '../../database/audit-log.service';
import { PlatformBusinessService } from '../platform-business.service';
import { MailOutboxPublisher } from '../mail-outbox.publisher';

describe('PlatformBusinessService.createBranch', () => {
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
  let service: PlatformBusinessService;
  let branchValues: unknown;
  let terminalValues: unknown;
  let terminalRows: Array<{ id: string; name: string; terminalCode: string }>;

  beforeEach(() => {
    jest.clearAllMocks();
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValue(undefined);
    redis.setIfAbsent.mockResolvedValue(true);
    redis.compareAndDelete.mockResolvedValue(true);
    auditLogs.insertPlatformEvent.mockResolvedValue(undefined);
    branchValues = undefined;
    terminalValues = undefined;
    terminalRows = [];

    const tx = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn().mockResolvedValue([{ id: businessId }]),
          })),
        })),
      })),
      insert: jest.fn((_table: unknown) => ({
        values: (values: unknown) => {
          if (Array.isArray(values)) {
            terminalValues = values;
            return { returning: jest.fn().mockResolvedValue(terminalRows) };
          }
          branchValues = values;
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
    service = new PlatformBusinessService(
      database as unknown as DatabaseService,
      {} as unknown as ObjectStoreService,
      redis as unknown as RedisService,
      auditLogs as unknown as AuditLogService,
      { notifyOutboxAvailable: jest.fn() } as unknown as MailOutboxPublisher,
    );
  });

  it('creates one default terminal when names are omitted', async () => {
    terminalRows = [
      { id: 'terminal-id', name: 'Initial Terminal', terminalCode: 'POS-01' },
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
        terminalCode: 'POS-01',
        status: 'active',
      },
    ]);
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

  it('creates all requested terminals with sequential branch-local codes', async () => {
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
      expect.objectContaining({ name: 'Counter One', terminalCode: 'POS-01' }),
      expect.objectContaining({ name: 'Counter Two', terminalCode: 'POS-02' }),
    ]);
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
