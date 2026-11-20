import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { createHash } from 'node:crypto';
import { DatabaseService } from '../../database/database.service';
import { ObjectStoreService } from '../../utils/objectStore.service';
import { PlatformBusinessService } from '../platform-business.service';
import { RedisService } from '../../redis/redis.service';
import { AuditLogService } from '../../database/audit-log.service';
import type { BusinessRequestDto } from '../dto/business-request.dto';
import type { ProvisionBusinessDto } from '../dto/provision-business.dto';

describe('PlatformBusinessService', () => {
  const database = { transactionWithSession: jest.fn() };
  const objectStore = {
    upload: jest.fn(),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const redis = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    setIfAbsent: jest.fn().mockResolvedValue(true),
    compareAndDelete: jest.fn().mockResolvedValue(true),
  };
  const auditLogs = {
    insertUserEvent: jest.fn().mockResolvedValue(undefined),
    insertPlatformEvent: jest.fn().mockResolvedValue(undefined),
    logUserEvent: jest.fn().mockResolvedValue(undefined),
  };
  const outboxPublisher = { notifyOutboxAvailable: jest.fn() };
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
      redis as unknown as RedisService,
      auditLogs as unknown as AuditLogService,
      outboxPublisher as never,
    );
  });

  it('returns a paginated business directory containing active and inactive records', async () => {
    const activeBusiness = {
      id: 'active-id',
      isActive: true,
    };
    const inactiveBusiness = {
      id: 'inactive-id',
      isActive: false,
    };
    const rows = [activeBusiness, inactiveBusiness];
    const query = {
      from: jest.fn(),
      orderBy: jest.fn(),
      limit: jest.fn(),
      offset: jest.fn().mockResolvedValue(rows),
    };
    query.from.mockReturnValue(query);
    query.orderBy.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    const tx = {
      select: jest
        .fn()
        .mockReturnValueOnce({
          from: jest.fn().mockResolvedValue([{ total: 2 }]),
        })
        .mockReturnValueOnce(query),
    };
    database.transactionWithSession.mockImplementation(
      async (_session: unknown, callback: (transaction: unknown) => unknown) =>
        callback(tx),
    );

    await expect(
      service.listBusinesses({ page: 2, limit: 2 }, 'platform-user-id'),
    ).resolves.toEqual({
      data: rows,
      pagination: { page: 2, limit: 2, total: 2, totalPages: 1 },
    });
    expect(database.transactionWithSession).toHaveBeenCalledWith(
      { isPlatform: true, platformUserId: 'platform-user-id' },
      expect.any(Function),
    );
    expect(query.limit).toHaveBeenCalledWith(2);
    expect(query.offset).toHaveBeenCalledWith(2);
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

  it('provisions an inactive business with branch, terminal, redemption, audit, and outbox in one platform transaction', async () => {
    const requestRow = {
      id: 'request-id',
      legalName: 'Example Retail Pvt. Ltd.',
      displayName: 'Example Retail',
      documents: {
        panCard: {
          frontImage: { fileId: 'pan-front', url: 'https://cdn/pan-front' },
          backImage: { fileId: 'pan-back', url: 'https://cdn/pan-back' },
        },
        businessRegistrationCertificate: {
          fileId: 'registration',
          url: 'https://cdn/registration',
        },
      },
      address: {
        country: 'NP',
        city: 'Kathmandu',
        postalCode: '12345',
        addressLine1: 'Main street',
        addressLine2: null,
      },
      primaryContactName: 'Owner',
      primaryContactEmail: 'owner@example.com',
      primaryContactPhone: '+9779812345678',
      status: 'pending',
      provisionedBusinessId: null,
    };
    const makeQuery = (rows: object[], lockable = false) => {
      const query = {
        from: jest.fn(),
        where: jest.fn(),
        limit: jest.fn(),
        for: jest.fn().mockResolvedValue(rows),
      };
      query.from.mockReturnValue(query);
      query.where.mockReturnValue(query);
      query.limit.mockReturnValue(lockable ? query : Promise.resolve(rows));
      return query;
    };
    const queries = [makeQuery([requestRow], true), makeQuery([])];
    const insertedValues: unknown[] = [];
    const insertedTables: unknown[] = [];
    const updatedValues: unknown[] = [];
    const updatedTables: unknown[] = [];
    const returningRows = [
      [{ id: 'business-id', displayName: 'Example Retail' }],
      [{ id: 'branch-id' }],
      [{ id: 'terminal-id' }],
    ];
    const tx = {
      select: jest.fn(() => {
        const query = queries.shift();
        if (!query) throw new Error('Unexpected select query');
        return query;
      }),
      insert: jest.fn((table: unknown) => {
        insertedTables.push(table);
        return {
          values: (values: unknown) => {
            insertedValues.push(values);
            const result = returningRows.shift();
            if (result) {
              return { returning: jest.fn().mockResolvedValue(result) };
            }
            return Promise.resolve([]);
          },
        };
      }),
      update: jest.fn((table: unknown) => {
        updatedTables.push(table);
        return {
          set: (values: unknown) => {
            updatedValues.push(values);
            return { where: jest.fn().mockResolvedValue([]) };
          },
        };
      }),
    };
    database.transactionWithSession.mockImplementation(
      async (_session: unknown, callback: (transaction: unknown) => unknown) =>
        callback(tx),
    );
    const input: ProvisionBusinessDto = {
      pan: 'abcde1234f',
      ownerEmail: 'OWNER-LOGIN@example.com',
    };

    const result = await service.provisionBusiness(
      'request-id',
      input,
      'provision-key-1',
      'platform-user-id',
    );

    expect(database.transactionWithSession).toHaveBeenCalledWith(
      { isPlatform: true, platformUserId: 'platform-user-id' },
      expect.any(Function),
    );
    expect(result).toMatchObject({
      businessId: 'business-id',
      ownerActivationInvitationStatus: 'queued',
    });
    expect(insertedValues[0]).toMatchObject({
      pan: 'ABCDE1234F',
      primaryContactEmail: 'owner@example.com',
      isActive: false,
      createdBy: 'platform-user-id',
    });
    expect(insertedValues[1]).toMatchObject({
      businessId: 'business-id',
      name: 'Main Branch',
      code: 'MAIN',
    });
    expect(insertedValues[2]).toMatchObject({
      businessId: 'business-id',
      branchId: 'branch-id',
      terminalCode: 'POS-01',
    });
    expect(insertedValues[3]).toMatchObject({
      businessId: 'business-id',
      requestId: 'request-id',
      emailNormalized: 'owner-login@example.com',
    });
    const outbox = insertedValues.at(-1) as {
      payload: { template: string; context: Record<string, unknown> };
    };
    expect(outbox.payload.template).toBe('redeem-code');
    expect(outbox.payload.context.redeemCode).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain(
      String(outbox.payload.context.redeemCode),
    );
    expect(updatedValues[0]).toMatchObject({
      status: 'approved',
      reviewedBy: 'platform-user-id',
      provisionedBusinessId: 'business-id',
    });
    expect(insertedTables).toHaveLength(5);
    expect(updatedTables).toHaveLength(1);
    expect(auditLogs.insertPlatformEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: 'business.provisioned' }),
    );
    expect(outboxPublisher.notifyOutboxAvailable).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining(':result'),
      expect.stringContaining('requestHash'),
      7 * 24 * 60 * 60,
    );
    expect(redis.compareAndDelete).toHaveBeenCalledTimes(1);
  });

  it('replays the saved response for the same idempotency key and request', async () => {
    const pan = 'ABCDE1234F';
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          requestId: 'request-id',
          pan,
          ownerEmail: null,
        }),
      )
      .digest('hex');
    const responseBody = { businessId: 'existing-business-id' };
    redis.get.mockResolvedValue(
      JSON.stringify({ requestHash, response: responseBody }),
    );

    await expect(
      service.provisionBusiness(
        'request-id',
        { pan },
        'same-key',
        'platform-id',
      ),
    ).resolves.toEqual(responseBody);
    expect(database.transactionWithSession).not.toHaveBeenCalled();
  });

  it('rejects reuse of an idempotency key with a different payload', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({ requestHash: 'different', response: {} }),
    );
    await expect(
      service.provisionBusiness(
        'request-id',
        { pan: 'ABCDE1234F' },
        'same-key',
        'platform-id',
      ),
    ).rejects.toThrow(
      'Idempotency-Key was already used with a different request',
    );
    expect(redis.setIfAbsent).not.toHaveBeenCalled();
  });

  it('rejects a concurrent request while the idempotency key is reserved', async () => {
    redis.get.mockResolvedValue(null);
    redis.setIfAbsent.mockResolvedValue(false);
    await expect(
      service.provisionBusiness(
        'request-id',
        { pan: 'ABCDE1234F' },
        'same-key',
        'platform-id',
      ),
    ).rejects.toThrow('A request with this Idempotency-Key is in progress');
  });

  it('fails closed before database writes when Redis is unavailable', async () => {
    redis.get.mockRejectedValue(new Error('Redis unavailable'));
    await expect(
      service.provisionBusiness(
        'request-id',
        { pan: 'ABCDE1234F' },
        'same-key',
        'platform-id',
      ),
    ).rejects.toThrow('Idempotency service is unavailable');
    expect(database.transactionWithSession).not.toHaveBeenCalled();
  });
});
