import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { ForbiddenException } from '@nestjs/common';
import { EndpointAccessService } from '../endpoint-access.service';

describe('EndpointAccessService', () => {
  let service: EndpointAccessService;
  const database = {
    transactionWithSession: jest.fn(),
  };
  const permissionsCache = {
    invalidate: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EndpointAccessService(
      database as never,
      permissionsCache as never,
    );
  });

  it('rejects configuration changes without an active business owner context', async () => {
    await expect(
      service.setRequiredRoles(
        { userId: 'user-1', businessId: 'business-1', isOwner: false },
        'inventory.create',
        ['role-1'],
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(database.transactionWithSession).not.toHaveBeenCalled();
  });

  it('requires at least one role when configuring an endpoint', async () => {
    await expect(
      service.setRequiredRoles(
        { userId: 'user-1', businessId: 'business-1', isOwner: true },
        'inventory.create',
        [],
      ),
    ).rejects.toThrow('At least one role is required');
  });

  it('rechecks the owner membership in the database before changing access', async () => {
    const query = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([]),
    };
    const transaction = { select: jest.fn(() => query) };
    database.transactionWithSession.mockImplementation(
      async (_session, callback) => callback(transaction),
    );

    await expect(
      service.setRequiredRoles(
        { userId: 'user-1', businessId: 'business-1', isOwner: true },
        'inventory.create',
        ['role-1'],
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('uses the authenticated business session for role checks', async () => {
    const session = {
      userId: 'user-1',
      businessId: 'business-1',
      isOwner: false,
    };
    let selectCount = 0;
    const tx = {
      select: jest.fn(() => {
        const queryIndex = ++selectCount;
        return {
          from: jest.fn(() => ({
            where: jest.fn(() => {
              const rows = queryIndex === 1 ? [{ roleId: 'role-1' }] : [];
              return Object.assign(Promise.resolve(rows), {
                limit: jest.fn().mockResolvedValue([{ roleId: 'role-1' }]),
              });
            }),
          })),
        };
      }),
    };
    database.transactionWithSession.mockImplementation(
      async (_session, callback) => callback(tx),
    );

    await expect(service.hasAccess(session, 'inventory.create')).resolves.toBe(
      true,
    );
    expect(database.transactionWithSession).toHaveBeenCalledWith(
      session,
      expect.any(Function),
    );
  });

  it('denies access when the active membership role is not configured', async () => {
    const transaction = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() =>
            Object.assign(Promise.resolve([{ roleId: 'cashier-role' }]), {
              limit: jest.fn().mockResolvedValue([{ roleId: 'manager-role' }]),
            }),
          ),
        })),
      })),
    };
    database.transactionWithSession.mockImplementation(
      async (_session, callback) => callback(transaction),
    );

    await expect(
      service.hasAccess(
        { userId: 'user-1', businessId: 'business-1' },
        'inventory.create',
      ),
    ).resolves.toBe(false);
  });
});
