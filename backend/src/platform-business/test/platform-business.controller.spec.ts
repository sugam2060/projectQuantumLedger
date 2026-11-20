import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { IS_PUBLIC } from '../../authentication/decorators/public.decorator';
import { RATE_LIMIT_KEY } from '../../authentication/decorators/rate-limit.decorator';
import { PlatformBusinessController } from '../platform-business.controller';
import { PlatformBusinessService } from '../platform-business.service';

describe('PlatformBusinessController', () => {
  const platformBusiness = {
    submitBusinessRequest: jest.fn(),
    provisionBusiness: jest.fn(),
    getBusinessDetails: jest.fn(),
  };
  let controller: PlatformBusinessController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [PlatformBusinessController],
      providers: [
        { provide: PlatformBusinessService, useValue: platformBusiness },
      ],
    }).compile();
    controller = module.get(PlatformBusinessController);
  });

  it('allows only platform users to read business details', async () => {
    const result = {
      business: { id: '00000000-0000-4000-8000-000000000010' },
      branches: [],
      memberships: [],
    };
    platformBusiness.getBusinessDetails.mockResolvedValue(result);
    const request = {
      user: { isPlatform: true, platformUserId: 'platform-user-id' },
      method: 'GET',
      route: { path: '/platform/business/:business_id' },
      ip: '127.0.0.1',
      header: jest
        .fn()
        .mockImplementation((name: string) =>
          name === 'x-client-type' ? 'mobile' : undefined,
        ),
    };

    await expect(
      controller.getBusiness(
        '00000000-0000-4000-8000-000000000010',
        request as never,
      ),
    ).resolves.toBe(result);
    expect(platformBusiness.getBusinessDetails).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000010',
      'platform-user-id',
      expect.objectContaining({
        method: 'GET',
        clientType: 'mobile',
      }),
    );

    await expect(
      controller.getBusiness('00000000-0000-4000-8000-000000000010', {
        ...request,
        user: { isPlatform: false },
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('makes the combined upload and request route public and rate limited', () => {
    const handler = PlatformBusinessController.prototype.submitRequest;
    expect(Reflect.getMetadata(IS_PUBLIC, handler)).toBe(true);
    expect(Reflect.getMetadata(RATE_LIMIT_KEY, handler)).toEqual(
      expect.objectContaining({ requests: 5, windowMs: 60 * 60_000 }),
    );
  });

  it('submits request data and all three files, then returns the acknowledgement', async () => {
    platformBusiness.submitBusinessRequest.mockResolvedValue(undefined);
    const body = { legalName: 'Retail', displayName: 'Retail Store' };
    const files = {
      panCardFront: { buffer: Buffer.from('%PDF-front') },
      panCardBack: { buffer: Buffer.from('%PDF-back') },
      businessRegistrationCertificate: { buffer: Buffer.from('%PDF-doc') },
    };

    await expect(
      controller.submitRequest(
        { clientType: 'web' },
        body as never,
        {
          panCardFront: [files.panCardFront as Express.Multer.File],
          panCardBack: [files.panCardBack as Express.Multer.File],
          businessRegistrationCertificate: [
            files.businessRegistrationCertificate as Express.Multer.File,
          ],
        },
        {
          method: 'POST',
          route: { path: '/platform/businesses/request' },
          ip: '127.0.0.1',
          header: jest.fn().mockReturnValue(undefined),
        } as never,
      ),
    ).resolves.toEqual({
      message:
        'Your request has been submitted. Our team will contact you for further process.',
    });
    expect(platformBusiness.submitBusinessRequest).toHaveBeenCalledWith(
      body,
      expect.objectContaining({
        panCardFront: files.panCardFront,
        panCardBack: files.panCardBack,
        businessRegistrationCertificate: files.businessRegistrationCertificate,
      }),
      expect.objectContaining({ endpointPath: '/platform/businesses/request' }),
    );
  });

  it('protects the provisioning route and delegates request, body, key, and actor', async () => {
    const result = { businessId: 'business-id' };
    platformBusiness.provisionBusiness.mockResolvedValue(result);
    const query = { requested_business_id: 'request-id' };
    const body = { pan: 'ABCDE1234F' };
    const headers = { clientType: 'web', idempotencyKey: 'request-1' };
    const request = {
      user: { isPlatform: true, platformUserId: 'platform-user-id' },
      method: 'POST',
      route: { path: '/platform/businesses/create' },
      ip: '127.0.0.1',
      header: jest.fn().mockReturnValue(undefined),
    };
    const handler = PlatformBusinessController.prototype.provisionBusiness;

    expect(Reflect.getMetadata(IS_PUBLIC, handler)).not.toBe(true);
    expect(Reflect.getMetadata(RATE_LIMIT_KEY, handler)).toEqual(
      expect.objectContaining({ requests: 20 }),
    );
    await expect(
      controller.provisionBusiness(
        query as never,
        body,
        headers as never,
        request as never,
      ),
    ).resolves.toBe(result);
    expect(platformBusiness.provisionBusiness).toHaveBeenCalledWith(
      'request-id',
      body,
      'request-1',
      'platform-user-id',
      expect.objectContaining({ endpointPath: '/platform/businesses/create' }),
    );
  });

  it('uses the verified JWT subject when the platformUserId mapping is absent', async () => {
    const request = {
      user: {
        isPlatform: true,
        subjectId: '00000000-0000-4000-8000-000000000009',
      },
      method: 'POST',
      route: { path: '/platform/businesses/create' },
      ip: '127.0.0.1',
      header: jest.fn().mockReturnValue(undefined),
    };

    await controller.provisionBusiness(
      { requested_business_id: 'request-id' } as never,
      { pan: 'ABCDE1234F' },
      { idempotencyKey: 'request-1' } as never,
      request as never,
    );

    expect(platformBusiness.provisionBusiness).toHaveBeenCalledWith(
      'request-id',
      { pan: 'ABCDE1234F' },
      'request-1',
      '00000000-0000-4000-8000-000000000009',
      expect.any(Object),
    );
  });

  it('does not allow a non-platform JWT to provision a business', async () => {
    await expect(
      controller.provisionBusiness(
        { requested_business_id: 'request-id' } as never,
        { pan: 'ABCDE1234F' },
        { idempotencyKey: 'request-1' } as never,
        {
          user: {
            isPlatform: false,
            platformUserId: '00000000-0000-4000-8000-000000000009',
          },
        } as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(platformBusiness.provisionBusiness).not.toHaveBeenCalled();
  });

  it('rejects a request if any required document file is missing', async () => {
    await expect(
      controller.submitRequest(
        { clientType: 'web' },
        {} as never,
        {
          panCardFront: [],
        },
        {} as never,
      ),
    ).rejects.toThrow(
      'PAN front, PAN back, and business registration files are required',
    );
    expect(platformBusiness.submitBusinessRequest).not.toHaveBeenCalled();
  });
});
