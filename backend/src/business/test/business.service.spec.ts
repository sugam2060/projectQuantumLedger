import { NotFoundException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { BusinessService } from '../business.service';

describe('BusinessService', () => {
  const limit = jest.fn();
  const where = jest.fn(() => ({ limit }));
  const from = jest.fn(() => ({ where }));
  const database = { select: jest.fn(() => ({ from })) };
  const service = new BusinessService(database as never);

  beforeEach(() => {
    jest.clearAllMocks();
    where.mockReturnValue({ limit });
    from.mockReturnValue({ where });
    database.select.mockReturnValue({ from } as never);
  });

  it('returns selected profile fields', async () => {
    const profile = { id: 'business-id', displayName: 'Shop', isActive: true };
    limit.mockResolvedValue([profile]);
    await expect(service.getBusinessProfile('business-id')).resolves.toBe(
      profile,
    );
    expect(database.select).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.anything(),
        isActive: expect.anything(),
      }),
    );
  });

  it('throws when the business does not exist', async () => {
    limit.mockResolvedValue([]);
    await expect(service.getBusinessProfile('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
