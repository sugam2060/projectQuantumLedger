import { jest } from '@jest/globals';
import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { businessMemberships } from '../../database/schema';
import { RedisService } from '../../redis/redis.service';
import { ObjectStoreService } from '../../utils/objectStore.service';
import { BusinessService } from '../business.service';
import { BusinessUtilsService } from '../business.utils.service';
import { ListBranchesQueryDto } from '../dto/list-branches-query.dto';

describe('BusinessService.listBranches', () => {
  const database = { transactionWithSession: jest.fn() };
  const redis = { get: jest.fn() };
  const objectStore = {};
  const auditLogs = { insertUserEvent: jest.fn() };
  const businessId = '00000000-0000-4000-8000-000000000001';
  const branchId = '00000000-0000-4000-8000-000000000002';
  const session = {
    businessId,
    userId: '00000000-0000-4000-8000-000000000003',
    isOwner: true,
  };
  let service: BusinessService;
  let membership: { branchId: string | null; isOwner: boolean };
  let branchRows: Array<Record<string, unknown>>;
  let branchWhere: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    membership = { branchId: null, isOwner: true };
    branchRows = [
      {
        id: branchId,
        name: 'Main Branch',
        code: 'MAIN',
        address: 'Main Street',
        contactNumber: '+977-1-5550100',
        isActive: true,
        createdAt: new Date('2026-10-15T12:00:00.000Z'),
        updatedAt: new Date('2026-10-16T12:00:00.000Z'),
      },
    ];
    branchWhere = jest.fn(() => ({
      orderBy: jest.fn(() => ({
        limit: jest.fn().mockResolvedValue(branchRows),
      })),
    }));
    const tx = {
      select: jest.fn(() => ({
        from: jest.fn((table: unknown) =>
          table === businessMemberships
            ? {
                where: jest.fn(() => ({
                  limit: jest.fn().mockResolvedValue([membership]),
                })),
              }
            : { where: branchWhere },
        ),
      })),
    };
    database.transactionWithSession.mockImplementation(
      async (_session: unknown, callback: (transaction: unknown) => unknown) =>
        callback(tx),
    );
    service = new BusinessService(
      database as unknown as DatabaseService,
      new BusinessUtilsService(redis as unknown as RedisService),
      objectStore as unknown as ObjectStoreService,
      auditLogs as never,
    );
  });

  it('returns current status and a next cursor when an extra row exists', async () => {
    branchRows = [
      ...branchRows,
      {
        ...branchRows[0],
        id: '00000000-0000-4000-8000-000000000004',
        createdAt: new Date('2026-10-14T12:00:00.000Z'),
      },
    ];
    const result = await service.listBranches(businessId, session, {
      limit: 1,
    } as ListBranchesQueryDto);

    expect(result.items).toMatchObject([
      { id: branchId, name: 'Main Branch', status: 'active' },
    ]);
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(branchWhere).toHaveBeenCalledTimes(1);
    expect(auditLogs.insertUserEvent).not.toHaveBeenCalled();
  });

  it('accepts the returned cursor for the next page', async () => {
    const cursor = new BusinessUtilsService(
      redis as unknown as RedisService,
    ).createBranchCursor(
      {
        createdAt: new Date('2026-10-15T12:00:00.000Z'),
        id: branchId,
      },
      { businessId, from: null, to: null, branchId: null },
    );
    const result = await service.listBranches(businessId, session, {
      limit: 50,
      cursor,
    } as ListBranchesQueryDto);
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  it('scopes a non-owner membership to its assigned branch', async () => {
    membership = { branchId, isOwner: false };
    await service.listBranches(businessId, { ...session, isOwner: false }, {
      limit: 50,
    } as ListBranchesQueryDto);
    expect(branchWhere).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid date range before querying the database', async () => {
    await expect(
      service.listBranches(businessId, session, {
        from: '2026-10-20T00:00:00Z',
        to: '2026-10-01T00:00:00Z',
        limit: 50,
      } as ListBranchesQueryDto),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(database.transactionWithSession).not.toHaveBeenCalled();
  });

  it('denies a session with no active membership', async () => {
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
        }),
    );
    await expect(
      service.listBranches(businessId, session, {
        limit: 50,
      } as ListBranchesQueryDto),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('maps unexpected database errors to service unavailable', async () => {
    database.transactionWithSession.mockRejectedValue(
      new Error('database down'),
    );
    await expect(
      service.listBranches(businessId, session, {
        limit: 50,
      } as ListBranchesQueryDto),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
