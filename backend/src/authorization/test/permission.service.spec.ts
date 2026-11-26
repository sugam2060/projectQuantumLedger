import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { Permission, PERMISSION_KEYS } from '../permission.constant';
import { PermissionService } from '../permission.service';
import {
  PLATFORM_ROLE_PERMISSIONS,
  PlatformPermission,
} from '../platform-permission.constant';

function setup() {
  const repository = {
    hasAll: jest.fn().mockResolvedValue(true),
    effective: jest.fn().mockResolvedValue(['business:read', 'legacy.key']),
  };
  return { service: new PermissionService(repository as never), repository };
}

describe('PermissionService', () => {
  it('delegates business checks to the database', async () => {
    const { service, repository } = setup();
    await expect(
      service.hasAll('u', 'b', 'br', [Permission.BRANCH_READ]),
    ).resolves.toBe(true);
    expect(repository.hasAll).toHaveBeenCalledWith('u', 'b', 'br', [
      'branch:read',
    ]);
  });

  it('never grants an empty requirement', async () => {
    const { service, repository } = setup();
    await expect(service.hasAll('u', 'b', undefined, [])).resolves.toBe(false);
    expect(repository.hasAll).not.toHaveBeenCalled();
  });

  it('returns only known permission keys', async () => {
    const { service } = setup();
    await expect(service.effective('u', 'b')).resolves.toEqual([
      'business:read',
    ]);
  });

  it('maps platform roles to platform permissions', () => {
    const { service } = setup();
    expect(
      service.platformHasAll({ platformRole: 'support' }, [
        PlatformPermission.BUSINESS_READ,
      ]),
    ).toBe(true);
    expect(
      service.platformHasAll({ platformRole: 'support' }, [
        PlatformPermission.BUSINESS_PROVISION,
      ]),
    ).toBe(false);
    expect(
      service.platformHasAll({ platformRole: 'manager' }, [
        PlatformPermission.PLATFORM_USER_INVITE,
      ]),
    ).toBe(false);
    expect(
      service.platformHasAll({ isBootstrap: true, platformRole: 'support' }, [
        PlatformPermission.PLATFORM_USER_INVITE,
      ]),
    ).toBe(true);
    expect(
      service.platformHasAll({ platformRole: 'root' }, [
        PlatformPermission.BUSINESS_READ,
      ]),
    ).toBe(false);
    expect(service.platformHasAll({ platformRole: 'admin' }, [])).toBe(false);
  });

  it('keeps the constants well-formed', () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
    for (const key of PERMISSION_KEYS) {
      expect(key).toMatch(/^[a-z]+(:[a-z_]+)+$/);
    }
    expect(PLATFORM_ROLE_PERMISSIONS.admin).toEqual(
      Object.values(PlatformPermission),
    );
  });
});
