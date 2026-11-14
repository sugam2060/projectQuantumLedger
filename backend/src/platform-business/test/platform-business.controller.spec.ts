import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { Test } from '@nestjs/testing';
import { IS_PUBLIC } from '../../authentication/decorators/public.decorator';
import { RATE_LIMIT_KEY } from '../../authentication/decorators/rate-limit.decorator';
import { PlatformBusinessController } from '../platform-business.controller';
import { PlatformBusinessService } from '../platform-business.service';

describe('PlatformBusinessController', () => {
  const platformBusiness = { submitBusinessRequest: jest.fn() };
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
      controller.submitRequest({ clientType: 'web' }, body as never, {
        panCardFront: [files.panCardFront as Express.Multer.File],
        panCardBack: [files.panCardBack as Express.Multer.File],
        businessRegistrationCertificate: [
          files.businessRegistrationCertificate as Express.Multer.File,
        ],
      }),
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
    );
  });

  it('rejects a request if any required document file is missing', async () => {
    await expect(
      controller.submitRequest({ clientType: 'web' }, {} as never, {
        panCardFront: [],
      }),
    ).rejects.toThrow(
      'PAN front, PAN back, and business registration files are required',
    );
    expect(platformBusiness.submitBusinessRequest).not.toHaveBeenCalled();
  });
});
