import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessControlGuard } from '../access-control.guard';
import { AuthenticatedUser } from '../../authenticated-user.interface';

describe('AccessControlGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  };
  let guard: AccessControlGuard;
  const user: AuthenticatedUser = {
    userId: '98b336f3-4481-4c90-a26a-388ae29ff607',
    sessionId: 'session-id',
    email: 'person@example.com',
    roles: ['cashier', 'manager'],
    permissions: ['sales.read', 'sales.refund'],
    memberships: [
      {
        businessId: 'business-one',
        branchIds: ['branch-one'],
        roles: ['cashier'],
        permissions: ['sales.read'],
        branchAccess: [
          {
            branchId: 'branch-one',
            roles: ['manager'],
            permissions: ['sales.refund'],
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new AccessControlGuard(reflector as unknown as Reflector);
  });

  it('authorizes permissions within the requested business and branch', () => {
    reflector.getAllAndOverride
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(['sales.refund']);

    expect(
      guard.canActivate(
        createContext(user, {
          params: { businessId: 'business-one', branchId: 'branch-one' },
        }),
      ),
    ).toBe(true);
  });

  it('does not let branch permissions grant access to another branch or business', () => {
    reflector.getAllAndOverride
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(['sales.refund']);

    expect(() =>
      guard.canActivate(
        createContext(user, {
          params: { businessId: 'business-one', branchId: 'branch-two' },
        }),
      ),
    ).toThrow(ForbiddenException);

    reflector.getAllAndOverride
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(['sales.refund']);

    expect(() =>
      guard.canActivate(
        createContext(user, {
          params: { businessId: 'business-two', branchId: 'branch-one' },
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('requires an explicit business scope for role or permission checks', () => {
    reflector.getAllAndOverride
      .mockReturnValueOnce(['cashier'])
      .mockReturnValueOnce(undefined);

    expect(() =>
      guard.canActivate(createContext(user, { params: {} })),
    ).toThrow(ForbiddenException);
  });
});

function createContext(
  user: AuthenticatedUser,
  request: { params: Record<string, string>; headers?: Record<string, string> },
): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => ({
        ...request,
        headers: request.headers ?? {},
        user,
      }),
    }),
  } as unknown as ExecutionContext;
}
