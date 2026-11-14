import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { RedisService } from '../../redis/redis.service';
import { EffectivePermissionsCacheService } from '../effective-permissions-cache.service';

describe('EffectivePermissionsCacheService', () => {
  const redis = {
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  };
  let service: EffectivePermissionsCacheService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EffectivePermissionsCacheService(
      redis as unknown as RedisService,
    );
  });

  it('reads and validates a permissions snapshot using a business and role key', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({ permissions: ['products.read'], roleVersion: 3 }),
    );

    await expect(service.get('business-1', 'role-1')).resolves.toEqual({
      permissions: ['products.read'],
      roleVersion: 3,
    });
    expect(redis.get).toHaveBeenCalledWith(
      'effective_permissions:business-1:role-1',
    );
  });

  it('treats malformed cached data as a miss and removes it', async () => {
    redis.get.mockResolvedValue('{bad json');

    await expect(service.get('business-1', 'role-1')).resolves.toBeNull();
    expect(redis.delete).toHaveBeenCalledWith(
      'effective_permissions:business-1:role-1',
    );
  });

  it('stores snapshots with a bounded TTL', async () => {
    await service.set('business-1', 'role-1', {
      permissions: ['products.read'],
      roleVersion: 3,
    });

    expect(redis.set).toHaveBeenCalledWith(
      'effective_permissions:business-1:role-1',
      JSON.stringify({ permissions: ['products.read'], roleVersion: 3 }),
      300,
    );
  });

  it('invalidates each unique role key for a business', async () => {
    await service.invalidate('business-1', ['role-1', 'role-2', 'role-1']);

    expect(redis.delete).toHaveBeenCalledTimes(2);
    expect(redis.delete).toHaveBeenCalledWith(
      'effective_permissions:business-1:role-1',
    );
    expect(redis.delete).toHaveBeenCalledWith(
      'effective_permissions:business-1:role-2',
    );
  });
});
