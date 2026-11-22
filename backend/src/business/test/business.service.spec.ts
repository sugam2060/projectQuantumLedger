import { NotFoundException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { BusinessService } from '../business.service';

describe('BusinessService', () => {
  const limit = jest.fn<(...args: any[]) => any>();
  const where = jest.fn<(...args: any[]) => any>(() => ({ limit }));
  const from = jest.fn<(...args: any[]) => any>(() => ({ where }));
  const database = {
    transactionWithSession: jest.fn<(...args: any[]) => any>(),
  };
  const service = new BusinessService(
    database as never,
    {} as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    where.mockReturnValue({ limit });
    from.mockReturnValue({ where });
    database.transactionWithSession.mockImplementation(
      async (_session: unknown, callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          select: jest.fn(() => ({ from })),
        }),
    );
  });

  it('returns selected profile fields', async () => {
    const profile = { id: 'business-id', displayName: 'Shop', isActive: true };
    limit.mockResolvedValue([profile]);
    const session = {
      userId: 'owner-id',
      businessId: 'business-id',
      isOwner: true,
    };
    await expect(
      service.getBusinessProfile('business-id', session),
    ).resolves.toBe(profile);
    expect(database.transactionWithSession).toHaveBeenCalledWith(
      session,
      expect.any(Function),
    );
  });

  it('throws when the business does not exist', async () => {
    limit.mockResolvedValue([]);
    await expect(
      service.getBusinessProfile('missing', {
        userId: 'owner-id',
        businessId: 'missing',
        isOwner: true,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
