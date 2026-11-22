import { BadRequestException } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { BusinessUtilsService } from '../business.utils.service';

describe('BusinessUtilsService branch cursors', () => {
  const service = new BusinessUtilsService({} as RedisService);
  const context = {
    businessId: '00000000-0000-4000-8000-000000000001',
    from: new Date('2026-10-01T00:00:00.000Z'),
    to: new Date('2026-10-29T23:59:59.000Z'),
    branchId: null,
  };
  const cursor = {
    createdAt: new Date('2026-10-15T12:00:00.000Z'),
    id: '00000000-0000-4000-8000-000000000002',
  };

  it('round-trips a cursor scoped to business, filters, and branch scope', () => {
    const encoded = service.createBranchCursor(cursor, context);
    expect(service.parseBranchCursor(encoded, context)).toEqual(cursor);
  });

  it('rejects malformed or out-of-scope cursors', () => {
    expect(() => service.parseBranchCursor('broken-cursor', context)).toThrow(
      BadRequestException,
    );
    const encoded = service.createBranchCursor(cursor, context);
    expect(() =>
      service.parseBranchCursor(encoded, { ...context, branchId: cursor.id }),
    ).toThrow(BadRequestException);
  });
});
