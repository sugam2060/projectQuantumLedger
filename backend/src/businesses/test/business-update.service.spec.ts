import { jest } from '@jest/globals';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuditLogsService } from '../../audit-logs';
import { DatabaseService } from '../../database/database.service';
import { RedisService } from '../../redis/redis.service';
import { ObjectStoreService } from '../../storage/object-store.service';
import { BusinessUpdateIdempotencyService } from '../business-update-idempotency.service';
import { BusinessesRepository } from '../businesses.repository';
import { BusinessesService } from '../businesses.service';

const mockFn = () => jest.fn<(...args: any[]) => any>();

describe('BusinessesService.updateBusinessProfile', () => {
  const redis = {
    get: mockFn(),
    set: mockFn(),
    setIfAbsent: mockFn(),
    compareAndDelete: mockFn(),
  };
  const objectStore = { upload: mockFn(), delete: mockFn() };
  const auditLogs = { insertUserEvent: mockFn() };
  const database = { transactionWithSession: mockFn() };
  let service: BusinessesService;
  let current: Record<string, unknown>;
  let tx: Record<string, jest.Mock>;

  const session = {
    userId: '00000000-0000-4000-8000-000000000002',
    businessId: '00000000-0000-4000-8000-000000000001',
    isOwner: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    current = {
      id: session.businessId,
      legalName: 'Legal Name Ltd',
      displayName: 'Old Display',
      pan: 'PAN123',
      address: 'Main Road',
      addressDetails: {
        country: 'NP',
        city: 'Kathmandu',
        postalCode: '44600',
        addressLine1: 'Main Road',
        addressLine2: null,
      },
      documents: {
        panCard: {
          frontImage: { fileId: 'old-front', url: 'https://files/old-front' },
          backImage: { fileId: 'old-back', url: 'https://files/old-back' },
        },
        businessRegistrationCertificate: {
          fileId: 'old-registration',
          url: 'https://files/old-registration',
        },
      },
      primaryContactNumber: '555-0100',
      primaryContactEmail: 'owner@example.com',
      isActive: false,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const businessLimit = mockFn().mockImplementation(() => ({
      for: mockFn().mockImplementation(async () =>
        current.id ? [current] : [],
      ),
    }));
    const whereSelect = mockFn().mockImplementation(() => ({
      limit: businessLimit,
    }));
    const valuesInsert = mockFn().mockResolvedValue(undefined);
    const whereUpdate = mockFn().mockImplementation(() => ({
      returning: mockFn().mockResolvedValue([
        { updatedAt: new Date('2026-02-01T00:00:00.000Z') },
      ]),
    }));
    const setUpdate = mockFn().mockImplementation(() => ({
      where: whereUpdate,
    }));
    tx = {
      select: mockFn().mockImplementation(() => ({
        from: mockFn().mockImplementation(() => ({ where: whereSelect })),
      })),
      update: mockFn().mockImplementation(() => ({ set: setUpdate })),
      insert: mockFn().mockImplementation(() => ({ values: valuesInsert })),
    };
    database.transactionWithSession.mockImplementation(
      async (_session: unknown, callback: (transaction: unknown) => unknown) =>
        callback(tx),
    );
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValue(undefined);
    redis.setIfAbsent.mockResolvedValue(true);
    redis.compareAndDelete.mockResolvedValue(true);
    objectStore.upload.mockResolvedValue({
      fileId: 'new-file',
      url: 'https://files/new-file',
      resourceType: 'raw',
      format: 'pdf',
    });
    objectStore.delete.mockResolvedValue(undefined);
    auditLogs.insertUserEvent.mockResolvedValue(undefined);
    service = new BusinessesService(
      new BusinessesRepository(database as unknown as DatabaseService),
      new BusinessUpdateIdempotencyService(redis as unknown as RedisService),
      objectStore as unknown as ObjectStoreService,
      auditLogs as unknown as AuditLogsService,
    );
  });

  it('updates permitted fields and writes its audit event in the transaction', async () => {
    const result = await service.updateBusinessProfile(
      session.businessId,
      session,
      { reason: 'Approved operation', displayName: 'New Display' },
      undefined,
      'idempotency-key',
    );

    expect(result).toEqual({
      businessId: session.businessId,
      updatedAt: '2026-02-01T00:00:00.000Z',
      changedFields: { displayName: 'New Display' },
    });
    expect(tx.update).toHaveBeenCalledTimes(1);
    expect(auditLogs.insertUserEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        eventType: 'BUSINESS_PROFILE_UPDATED',
        metadata: expect.objectContaining({ reason: 'Approved operation' }),
      }),
    );
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining(':result'),
      expect.any(String),
      7 * 24 * 60 * 60,
    );
  });

  it('replays a completed idempotency request without updating again', async () => {
    await service.updateBusinessProfile(
      session.businessId,
      session,
      { reason: 'Approved operation', displayName: 'New Display' },
      undefined,
      'idempotency-key',
    );
    const cachedEntry = redis.set.mock.calls[0]?.[1];
    redis.get.mockResolvedValue(cachedEntry as string);
    const transactionCount = database.transactionWithSession.mock.calls.length;

    const replay = await service.updateBusinessProfile(
      session.businessId,
      session,
      { reason: 'Approved operation', displayName: 'New Display' },
      undefined,
      'idempotency-key',
    );
    expect(replay.changedFields).toEqual({ displayName: 'New Display' });
    expect(database.transactionWithSession).toHaveBeenCalledTimes(
      transactionCount,
    );
  });

  it('stages a replacement document and deletes the old object after commit', async () => {
    const file = {
      originalname: 'front.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from('new document'),
    } as Express.Multer.File;
    const result = await service.updateBusinessProfile(
      session.businessId,
      session,
      { reason: 'Approved document replacement' },
      { panCardFront: [file] },
      'document-key',
    );

    expect(objectStore.upload).toHaveBeenCalledWith(file);
    expect(result.changedFields.documents).toEqual(['panCard.frontImage']);
    expect(objectStore.delete).toHaveBeenCalledWith('old-front');
    expect(auditLogs.insertUserEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        metadata: expect.objectContaining({
          changedFields: ['documents'],
          newValues: { documents: ['panCard.frontImage'] },
        }),
      }),
    );
  });

  it('keeps addressDetails and the legacy address value synchronized', async () => {
    await service.updateBusinessProfile(
      session.businessId,
      session,
      { reason: 'Address correction', addressLine1: 'New Road' },
      undefined,
      'address-key',
    );
    const updateCall = tx.update.mock.results[0]?.value as {
      set: jest.Mock;
    };
    expect(updateCall.set).toHaveBeenCalledWith(
      expect.objectContaining({
        address: 'New Road',
        addressDetails: expect.objectContaining({ addressLine1: 'New Road' }),
      }),
    );
  });

  it('rejects reuse of an idempotency key with a different payload', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({ requestHash: 'different-hash', response: {} }),
    );
    await expect(
      service.updateBusinessProfile(
        session.businessId,
        session,
        { reason: 'Approved operation', displayName: 'New Display' },
        undefined,
        'idempotency-key',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a request while another request holds its idempotency lock', async () => {
    redis.setIfAbsent.mockResolvedValue(false);
    await expect(
      service.updateBusinessProfile(
        session.businessId,
        session,
        { reason: 'Approved operation', displayName: 'New Display' },
        undefined,
        'idempotency-key',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(database.transactionWithSession).not.toHaveBeenCalled();
  });

  it('fails closed when Redis cannot be reached before the update', async () => {
    redis.get.mockRejectedValue(new Error('redis down'));
    await expect(
      service.updateBusinessProfile(
        session.businessId,
        session,
        { reason: 'Approved operation', displayName: 'New Display' },
        undefined,
        'idempotency-key',
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(database.transactionWithSession).not.toHaveBeenCalled();
  });

  it('denies a session without a user before touching Redis', async () => {
    await expect(
      service.updateBusinessProfile(
        session.businessId,
        { businessId: session.businessId },
        { reason: 'Approved operation', displayName: 'New Display' },
        undefined,
        'idempotency-key',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('answers 404 when row-level security hides the business', async () => {
    current = {};
    await expect(
      service.updateBusinessProfile(
        session.businessId,
        session,
        { reason: 'Approved operation', displayName: 'New Display' },
        undefined,
        'idempotency-key',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.update).not.toHaveBeenCalled();
    expect(auditLogs.insertUserEvent).not.toHaveBeenCalled();
  });

  it('rolls back the update when the required audit insert fails', async () => {
    auditLogs.insertUserEvent.mockRejectedValue(new Error('audit unavailable'));
    await expect(
      service.updateBusinessProfile(
        session.businessId,
        session,
        { reason: 'Approved operation', displayName: 'New Display' },
        undefined,
        'idempotency-key',
      ),
    ).rejects.toThrow('audit unavailable');
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.compareAndDelete).toHaveBeenCalled();
  });

  it('cleans up staged files when the audit transaction fails', async () => {
    auditLogs.insertUserEvent.mockRejectedValue(new Error('audit unavailable'));
    const file = {
      originalname: 'front.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from('new document'),
    } as Express.Multer.File;
    await expect(
      service.updateBusinessProfile(
        session.businessId,
        session,
        { reason: 'Approved document replacement' },
        { panCardFront: [file] },
        'document-key',
      ),
    ).rejects.toThrow('audit unavailable');
    expect(objectStore.delete).toHaveBeenCalledWith('new-file');
  });
});
