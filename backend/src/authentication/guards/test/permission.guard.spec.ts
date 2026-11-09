import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from '../permission.guard';
import { REQUIRED_ROLES } from '../../decorators/required_permission.decorator';

describe('PermissionGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  };
  const endpointAccess = {
    hasAccess: jest.fn(),
  };
  const request = { user: { userId: 'user-1', businessId: 'business-1' } };
  const context = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  let guard: PermissionGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new PermissionGuard(
      reflector as unknown as Reflector,
      endpointAccess as never,
    );
  });

  it('allows routes without dynamic role requirements', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(endpointAccess.hasAccess).not.toHaveBeenCalled();
  });

  it('checks the endpoint key and denies users without an assigned role', async () => {
    reflector.getAllAndOverride
      .mockReturnValueOnce(false)
      .mockReturnValue('inventory.create');
    endpointAccess.hasAccess.mockResolvedValue(false);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      REQUIRED_ROLES,
      expect.any(Array),
    );
    expect(endpointAccess.hasAccess).toHaveBeenCalledWith(
      request.user,
      'inventory.create',
    );
  });

  it('allows users whose active role matches the endpoint configuration', async () => {
    reflector.getAllAndOverride
      .mockReturnValueOnce(false)
      .mockReturnValue('inventory.create');
    endpointAccess.hasAccess.mockResolvedValue(true);

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
