import { ForbiddenException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { REQUIRED_ROLES } from '../../authentication/decorators/required_permission.decorator';
import { BusinessController } from '../business.controller';

const mockFn = () => jest.fn<(...args: any[]) => any>();

describe('BusinessController', () => {
  const service = {
    getBusinessProfile: mockFn(),
    updateBusinessProfile: mockFn(),
  };
  const controller = new BusinessController(service as never);
  const businessId = '00000000-0000-4000-8000-000000000001';

  beforeEach(() => jest.clearAllMocks());

  it('registers the business read permission key', () => {
    expect(
      Reflect.getMetadata(
        REQUIRED_ROLES,
        Object.getOwnPropertyDescriptor(
          BusinessController.prototype,
          'getBusiness',
        )?.value,
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

  it('routes an authorized owner update with files and audit context', async () => {
    const result = { businessId, updatedAt: '2026-02-01T00:00:00.000Z' };
    service.updateBusinessProfile.mockResolvedValue(result);
    const user = { isOwner: true, businessId, userId: 'owner-id' };
    const dto = { reason: 'Approved operation', displayName: 'New name' };
    const files = { panCardFront: [{ originalname: 'front.pdf' }] };
    const headers = { idempotencyKey: 'key-1', clientType: 'desktop' };
    const request = {
      user,
      method: 'PATCH',
      route: { path: ':businessId' },
      header: (name: string) =>
        name === 'x-client-type' ? 'desktop' : undefined,
      ip: '127.0.0.1',
    };

    await expect(
      controller.updateBusiness(
        { businessId },
        dto,
        headers,
        files as never,
        request as never,
      ),
    ).resolves.toBe(result);
    expect(service.updateBusinessProfile).toHaveBeenCalledWith(
      businessId,
      user,
      dto,
      files,
      'key-1',
      expect.objectContaining({ method: 'PATCH', clientType: 'desktop' }),
    );
  });

  it('registers the business update permission key', () => {
    expect(
      Reflect.getMetadata(
        REQUIRED_ROLES,
        Object.getOwnPropertyDescriptor(
          BusinessController.prototype,
          'updateBusiness',
        )?.value,
      ),
    ).toBe('business.update');
  });
});
