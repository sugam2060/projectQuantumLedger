import { jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { AuditLogsService } from '../../audit-logs';
import { DatabaseService } from '../../database/database.service';
import { ObjectStoreService } from '../../utils/objectStore.service';
import { BusinessService } from '../business.service';
import { BusinessUtilsService } from '../business.utils.service';

const mockFn = () => jest.fn<(...args: any[]) => any>();

describe('BusinessService.activateTerminal', () => {
  const database = { transactionWithSession: mockFn() };
  const auditLogs = { insertUserEvent: mockFn() };
  const service = new BusinessService(
    database as unknown as DatabaseService,
    {} as BusinessUtilsService,
    {} as ObjectStoreService,
    auditLogs as unknown as AuditLogsService,
  );
  const businessId = '00000000-0000-4000-8000-000000000001';
  const branchId = '00000000-0000-4000-8000-000000000002';
  const session = {
    businessId,
    branchId,
    userId: '00000000-0000-4000-8000-000000000003',
    isOwner: true,
    isPlatform: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requires owner access for terminal activation', async () => {
    await expect(
      service.activateTerminal(businessId, branchId, 'POS-A1B2C3D4E5F60718', {
        ...session,
        isOwner: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(database.transactionWithSession).not.toHaveBeenCalled();
  });

  it('activates the matching terminal and audits without storing its code', async () => {
    const updated = {
      id: 'terminal-id',
      name: 'Front Counter',
      terminalCode: 'POS-A1B2C3D4E5F60718',
      status: 'active',
    };
    const tx = {
      execute: mockFn().mockResolvedValue(undefined),
      select: mockFn().mockImplementation(() => ({
        from: mockFn().mockImplementation(() => ({
          where: mockFn().mockImplementation(() => ({
            limit: jest
              .fn<(...args: any[]) => any>()
              .mockResolvedValue([{ ...updated, status: 'inactive' }]),
          })),
        })),
      })),
      update: mockFn().mockImplementation(() => ({
        set: mockFn().mockImplementation(() => ({
          where: mockFn().mockImplementation(() => ({
            returning: mockFn().mockResolvedValue([updated]),
          })),
        })),
      })),
    };
    database.transactionWithSession.mockImplementation(
      async (_session: unknown, callback: (transaction: unknown) => unknown) =>
        callback(tx),
    );
    auditLogs.insertUserEvent.mockResolvedValue(undefined);

    await expect(
      service.activateTerminal(
        businessId,
        branchId,
        updated.terminalCode,
        session,
      ),
    ).resolves.toEqual(updated);
    expect(tx.execute).toHaveBeenCalledTimes(1);
    expect(auditLogs.insertUserEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        eventType: 'TERMINAL_ACTIVATED',
        metadata: { terminalId: 'terminal-id', branchId },
      }),
    );
    expect(
      JSON.stringify(auditLogs.insertUserEvent.mock.calls[0]),
    ).not.toContain(updated.terminalCode);
  });
});
