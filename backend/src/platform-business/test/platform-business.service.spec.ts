import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { DatabaseService } from '../../database/database.service';
import { ObjectStoreService } from '../../utils/objectStore.service';
import { PlatformBusinessService } from '../platform-business.service';
import type { BusinessRequestDto } from '../dto/business-request.dto';

describe('PlatformBusinessService', () => {
  const database = { transactionWithSession: jest.fn() };
  const objectStore = {
    upload: jest.fn(),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  let service: PlatformBusinessService;

  const request = {
    legalName: ' Example Retail Pvt. Ltd. ',
    displayName: ' Example Retail ',
    country: ' np ',
    city: ' Kathmandu ',
    postalCode: '123123123',
    addressLine1: 'Street 1',
    addressLine2: ' Suite 2 ',
    primaryContactName: ' Example Owner ',
    primaryContactEmail: ' OWNER@EXAMPLE.COM ',
    primaryContactPhone: '+9779812345678',
  } as BusinessRequestDto;

  const files = {
    panCardFront: {
      buffer: Buffer.from('%PDF-front'),
      mimetype: 'application/pdf',
    } as Express.Multer.File,
    panCardBack: {
      buffer: Buffer.from('%PDF-back'),
      mimetype: 'application/pdf',
    } as Express.Multer.File,
    businessRegistrationCertificate: {
      buffer: Buffer.from('%PDF-certificate'),
      mimetype: 'application/pdf',
    } as Express.Multer.File,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    objectStore.delete.mockResolvedValue(undefined);
    objectStore.upload
      .mockResolvedValueOnce({
        fileId: 'business-request-documents/pan-front',
        url: 'https://cdn.example/pan-front.pdf',
      })
      .mockResolvedValueOnce({
        fileId: 'business-request-documents/pan-back',
        url: 'https://cdn.example/pan-back.pdf',
      })
      .mockResolvedValueOnce({
        fileId: 'business-request-documents/registration',
        url: 'https://cdn.example/registration.pdf',
      });
    service = new PlatformBusinessService(
      database as unknown as DatabaseService,
      objectStore as unknown as ObjectStoreService,
    );
  });

  it('uploads all documents and saves their Cloudinary IDs and URLs with the request', async () => {
    const values = jest.fn().mockResolvedValue(undefined);
    const tx = { insert: jest.fn().mockReturnValue({ values }) };
    database.transactionWithSession.mockImplementation(
      async (_session: unknown, callback: (transaction: unknown) => unknown) =>
        callback(tx),
    );

    await expect(
      service.submitBusinessRequest(request, files),
    ).resolves.toBeUndefined();

    expect(objectStore.upload).toHaveBeenNthCalledWith(1, files.panCardFront);
    expect(objectStore.upload).toHaveBeenNthCalledWith(2, files.panCardBack);
    expect(objectStore.upload).toHaveBeenNthCalledWith(
      3,
      files.businessRegistrationCertificate,
    );
    expect(database.transactionWithSession).toHaveBeenCalledWith(
      {},
      expect.any(Function),
    );
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        legalName: 'Example Retail Pvt. Ltd.',
        displayName: 'Example Retail',
        address: {
          country: 'NP',
          city: 'Kathmandu',
          postalCode: '123123123',
          addressLine1: 'Street 1',
          addressLine2: 'Suite 2',
        },
        primaryContactName: 'Example Owner',
        primaryContactEmail: 'owner@example.com',
        primaryContactPhone: '+9779812345678',
        documents: {
          panCard: {
            frontImage: {
              fileId: 'business-request-documents/pan-front',
              url: 'https://cdn.example/pan-front.pdf',
            },
            backImage: {
              fileId: 'business-request-documents/pan-back',
              url: 'https://cdn.example/pan-back.pdf',
            },
          },
          businessRegistrationCertificate: {
            fileId: 'business-request-documents/registration',
            url: 'https://cdn.example/registration.pdf',
          },
        },
      }),
    );
  });

  it('cleans up already-uploaded documents if a later upload fails', async () => {
    objectStore.upload
      .mockReset()
      .mockResolvedValueOnce({
        fileId: 'business-request-documents/pan-front',
        url: 'https://cdn.example/pan-front.pdf',
      })
      .mockRejectedValueOnce(new Error('Cloudinary upload failed'));

    await expect(service.submitBusinessRequest(request, files)).rejects.toThrow(
      'Cloudinary upload failed',
    );
    expect(objectStore.delete).toHaveBeenCalledWith(
      'business-request-documents/pan-front',
    );
    expect(database.transactionWithSession).not.toHaveBeenCalled();
  });

  it('cleans up uploaded documents if database persistence fails', async () => {
    database.transactionWithSession.mockRejectedValue(
      new Error('database write failed'),
    );

    await expect(service.submitBusinessRequest(request, files)).rejects.toThrow(
      'database write failed',
    );
    expect(objectStore.delete).toHaveBeenCalledTimes(3);
  });
});
