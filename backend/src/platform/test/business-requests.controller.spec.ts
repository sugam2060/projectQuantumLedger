import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { THROTTLE_OVERRIDE_KEY } from '../../common/throttling/throttling.constants';
import { BusinessRequestsController } from '../business-requests.controller';
import { BusinessRequestsService } from '../business-requests.service';

describe('BusinessRequestsController', () => {
  const businessRequests = { submitBusinessRequest: jest.fn() };
  const controller = new BusinessRequestsController(
    businessRequests as unknown as BusinessRequestsService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('makes the combined upload and request route public and rate limited', () => {
    const handler = BusinessRequestsController.prototype.submitRequest;
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata(THROTTLE_OVERRIDE_KEY, handler)).toEqual(
      expect.objectContaining({ limit: 5, ttlMs: 60 * 60_000 }),
    );
  });

  it('submits request data and all three files, then returns the acknowledgement', async () => {
    businessRequests.submitBusinessRequest.mockResolvedValue(undefined);
    const body = { legalName: 'Retail', displayName: 'Retail Store' };
    const files = {
      panCardFront: { buffer: Buffer.from('%PDF-front') },
      panCardBack: { buffer: Buffer.from('%PDF-back') },
      businessRegistrationCertificate: { buffer: Buffer.from('%PDF-doc') },
    };
    const auditContext = {
      method: 'POST',
      endpointPath: '/platform/businesses/request',
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
        auditContext,
      ),
    ).resolves.toEqual({
      message:
        'Your request has been submitted. Our team will contact you for further process.',
    });
    expect(businessRequests.submitBusinessRequest).toHaveBeenCalledWith(
      body,
      expect.objectContaining({
        panCardFront: files.panCardFront,
        panCardBack: files.panCardBack,
        businessRegistrationCertificate: files.businessRegistrationCertificate,
      }),
      auditContext,
    );
  });

  it('rejects a request if any required document file is missing', async () => {
    await expect(
      controller.submitRequest(
        { clientType: 'web' },
        {} as never,
        { panCardFront: [] },
        {},
      ),
    ).rejects.toThrow(
      'PAN front, PAN back, and business registration files are required',
    );
    expect(businessRequests.submitBusinessRequest).not.toHaveBeenCalled();
  });
});
