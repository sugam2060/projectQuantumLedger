import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../../common/types';
import {
  REQUIRED_PERMISSIONS_KEY,
  REQUIRED_PLATFORM_PERMISSIONS_KEY,
} from '../decorators/required-permission.decorator';
import { PERMISSION_DENIED, PermissionGuard } from '../guards/permission.guard';
import { Permission } from '../permission.constant';
import { PlatformPermission } from '../platform-permission.constant';
import type { AuthorizedRequest } from '../types';

const BUSINESS = '00000000-0000-4000-8000-000000000001';
const BRANCH = '00000000-0000-4000-8000-000000000002';
const USER = '00000000-0000-4000-8000-000000000003';

const member: AuthenticatedUser = {
  subjectId: USER,
  userId: USER,
  isPlatform: false,
  permissions: [],
};
const staff: AuthenticatedUser = {
  subjectId: USER,
  platformUserId: USER,
  isPlatform: true,
  platformRole: 'support',
  permissions: [],
};

function setup(metadata: Record<string, unknown>) {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => metadata[key]),
  } as unknown as Reflector;
  const permissions = {
    hasAll: jest.fn().mockResolvedValue(true),
    platformHasAll: jest.fn().mockReturnValue(true),
  };
  const guard = new PermissionGuard(reflector, permissions as never);
  const run = (request: Partial<AuthorizedRequest>) =>
    guard.canActivate({
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext);
  return { run, permissions };
}

const business = { [REQUIRED_PERMISSIONS_KEY]: [Permission.BUSINESS_READ] };

describe('PermissionGuard', () => {
  it('passes routes without requirements and public routes', async () => {
    await expect(setup({}).run({})).resolves.toBe(true);
    await expect(
      setup({ ...business, [IS_PUBLIC_KEY]: true }).run({}),
    ).resolves.toBe(true);
  });

  it('answers 401 when nobody is authenticated', async () => {
    await expect(
      setup(business).run({ params: { businessId: BUSINESS } }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('answers 400 for malformed scope ids', async () => {
    await expect(
      setup(business).run({ user: member, params: { businessId: 'nope' } }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      setup(business).run({
        user: member,
        params: { businessId: BUSINESS, branchId: '1' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fails loudly when a protected route has no :businessId', async () => {
    await expect(
      setup(business).run({ user: member, params: {} }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('checks every permission at the branch and records the scope', async () => {
    const { run, permissions } = setup({
      [REQUIRED_PERMISSIONS_KEY]: [
        Permission.BRANCH_READ,
        Permission.TERMINAL_ACTIVATE,
      ],
    });
    const request: Partial<AuthorizedRequest> = {
      user: member,
      params: { businessId: BUSINESS.toUpperCase(), branchId: BRANCH },
    };
    await expect(run(request)).resolves.toBe(true);
    expect(permissions.hasAll).toHaveBeenCalledWith(USER, BUSINESS, BRANCH, [
      'branch:read',
      'terminal:activate',
    ]);
    expect(request.authorizedBusinessId).toBe(BUSINESS);
    expect(request.authorizedBranchId).toBe(BRANCH);
  });

  it('denies with one generic 403 when the database says no', async () => {
    const { run, permissions } = setup(business);
    permissions.hasAll.mockResolvedValue(false);
    await expect(
      run({ user: member, params: { businessId: BUSINESS } }),
    ).rejects.toThrow(new ForbiddenException(PERMISSION_DENIED));
  });

  it('never lets a platform token use a business permission', async () => {
    const { run, permissions } = setup(business);
    await expect(
      run({ user: staff, params: { businessId: BUSINESS } }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(permissions.hasAll).not.toHaveBeenCalled();
  });

  it('checks platform permissions against the platform role', async () => {
    const metadata = {
      [REQUIRED_PLATFORM_PERMISSIONS_KEY]: [PlatformPermission.BUSINESS_READ],
    };
    const { run, permissions } = setup(metadata);
    await expect(run({ user: staff })).resolves.toBe(true);
    expect(permissions.platformHasAll).toHaveBeenCalledWith(staff, [
      'platform:business:read',
    ]);

    permissions.platformHasAll.mockReturnValue(false);
    await expect(run({ user: staff })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(setup(metadata).run({ user: member })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
