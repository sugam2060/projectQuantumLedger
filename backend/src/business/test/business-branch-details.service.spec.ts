import { jest } from '@jest/globals';
import {
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { RedisService } from '../../redis/redis.service';
import { ObjectStoreService } from '../../utils/objectStore.service';
import { BusinessService } from '../business.service';
import { BusinessUtilsService } from '../business.utils.service';

const mockFn = () => jest.fn<(...args: any[]) => any>();

describe('BusinessService.getBranchDetails', () => {
  const database = { transactionWithSession: mockFn() };
  const redis = { get: mockFn() };
  const auditLogs = { insertUserEvent: mockFn() };
  const businessId = '00000000-0000-4000-8000-000000000001';
  const branchId = '00000000-0000-4000-8000-000000000002';
  const session = {
    businessId,
    userId: '00000000-0000-4000-8000-000000000003',
    isOwner: true,
  };
  let service: BusinessService;
  let membership: { branchId: string | null; isOwner: boolean } | undefined;
  let branch: Record<string, unknown> | undefined;
  let terminalCounts: Array<{ status: string; total: number }>;
  let memberCounts: Array<{ isActive: boolean; total: number }>;

  beforeEach(() => {
    jest.clearAllMocks();
    membership = { branchId: null, isOwner: true };
    branch = {
      id: branchId,
      businessId,
      name: 'Main Branch',
      code: 'MAIN',
      address: 'Main Street',
      contactNumber: '+977-1-5550100',
      isActive: true,
      createdAt: new Date('2026-10-15T12:00:00.000Z'),
      updatedAt: new Date('2026-10-16T12:00:00.000Z'),
    };
    terminalCounts = [
      { status: 'active', total: 2 },
      { status: 'maintenance', total: 1 },
    ];
    memberCounts = [
      { isActive: true, total: 4 },
      { isActive: false, total: 1 },
    ];

    const tx = {
      select: mockFn().mockImplementation(() => {
        const queryNumber = txSelectCount++;
        return {
          from: mockFn().mockImplementation(() => ({
            where: mockFn().mockImplementation(() => ({
              limit: mockFn().mockResolvedValue(
                queryNumber === 0
                  ? membership
                    ? [membership]
                    : []
                  : branch
                    ? [branch]
                    : [],
              ),
              groupBy: mockFn().mockResolvedValue(
                queryNumber === 2 ? terminalCounts : memberCounts,
              ),
            })),
          })),
        };
      }),
    };
    let txSelectCount = 0;
    database.transactionWithSession.mockImplementation(
      async (
        _requestSession: unknown,
        callback: (transaction: unknown) => unknown,
      ) => {
        txSelectCount = 0;
        return callback(tx);
      },
    );
    service = new BusinessService(
      database as unknown as DatabaseService,
      new BusinessUtilsService(redis as unknown as RedisService),
      {} as unknown as ObjectStoreService,
      auditLogs as never,
    );
  });

  it('returns branch details and grouped operational counts', async () => {
    await expect(
      service.getBranchDetails(businessId, branchId, session),
    ).resolves.toEqual({
      branch: {
        id: branchId,
        businessId,
        name: 'Main Branch',
        code: 'MAIN',
        address: 'Main Street',
        contactNumber: '+977-1-5550100',
        createdAt: new Date('2026-10-15T12:00:00.000Z'),
        updatedAt: new Date('2026-10-16T12:00:00.000Z'),
        status: 'active',
      },
      summary: {
        terminals: { active: 2, inactive: 0, maintenance: 1, total: 3 },
        members: { active: 4, inactive: 1, total: 5 },
      },
    });
    expect(auditLogs.insertUserEvent).not.toHaveBeenCalled();
  });

  it('hides branches outside the member assigned scope', async () => {
    membership = {
      branchId: '00000000-0000-4000-8000-000000000004',
      isOwner: false,
    };
    await expect(
      service.getBranchDetails(businessId, branchId, {
        ...session,
        isOwner: false,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires an active business membership', async () => {
    membership = undefined;
    await expect(
      service.getBranchDetails(businessId, branchId, session),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns not found when the branch does not exist', async () => {
    branch = undefined;
    await expect(
      service.getBranchDetails(businessId, branchId, session),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('maps unexpected database errors to service unavailable', async () => {
    database.transactionWithSession.mockRejectedValue(
      new Error('database down'),
    );
    await expect(
      service.getBranchDetails(businessId, branchId, session),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
