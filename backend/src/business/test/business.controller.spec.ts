import { ForbiddenException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { REQUIRED_ROLES } from '../../authentication/decorators/required_permission.decorator';
import { BusinessController } from '../business.controller';

describe('BusinessController', () => {
  const service = { getBusinessProfile: jest.fn() };
  const controller = new BusinessController(service as never);
  const businessId = '00000000-0000-4000-8000-000000000001';

  beforeEach(() => jest.clearAllMocks());

  it('registers the business read permission key', () => {
    expect(
      Reflect.getMetadata(
        REQUIRED_ROLES,
        BusinessController.prototype.getBusiness,
      ),
    ).toBe('business.read');
  });

  it('returns the profile for the owner of the requested business', async () => {
    const profile = { id: businessId, isActive: false };
    service.getBusinessProfile.mockResolvedValue(profile);
    await expect(
      controller.getBusiness({ businessId }, {
        user: { isOwner: true, businessId },
      } as never),
    ).resolves.toBe(profile);
    expect(service.getBusinessProfile).toHaveBeenCalledWith(businessId);
  });

  it.each([
    ['non-owner', { isOwner: false, businessId }],
    [
      'different business',
      { isOwner: true, businessId: '00000000-0000-4000-8000-000000000002' },
    ],
    ['platform owner', { isOwner: true, isPlatform: true, businessId }],
  ])('denies %s access', (_description, user) => {
    expect(() =>
      controller.getBusiness({ businessId }, { user } as never),
    ).toThrow(ForbiddenException);
    expect(service.getBusinessProfile).not.toHaveBeenCalled();
  });
});
