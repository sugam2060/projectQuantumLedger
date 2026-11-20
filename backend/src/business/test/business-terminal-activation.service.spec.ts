import { jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { AuditLogService } from '../../database/audit-log.service';
import { DatabaseService } from '../../database/database.service';
import { ObjectStoreService } from '../../utils/objectStore.service';
import { BusinessService } from '../business.service';
import { BusinessUtilsService } from '../business.utils.service';

describe('BusinessService.activateTerminal', () => {
  const database = { transactionWithSession: jest.fn() };
  const auditLogs = { insertUserEvent: jest.fn() };
  const service = new BusinessService(
    database as unknown as DatabaseService,
    {} as BusinessUtilsService,
    {} as ObjectStoreService,
    auditLogs as unknown as AuditLogService,
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
      execute: jest.fn().mockResolvedValue(undefined),
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest
              .fn()
              .mockResolvedValue([{ ...updated, status: 'inactive' }]),
          })),
        })),
      })),
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            returning: jest.fn().mockResolvedValue([updated]),
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
