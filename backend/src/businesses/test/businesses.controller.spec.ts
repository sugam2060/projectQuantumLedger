import { ForbiddenException } from '@nestjs/common';
import { jest } from '@jest/globals';
import {
  REQUIRE_CONFIGURED_ROLES,
  REQUIRED_ROLES,
} from '../../authentication/decorators/required_permission.decorator';
import type { AuthenticatedUser } from '../../common/types';
import { BranchesController } from '../branches.controller';
import { BusinessesController } from '../businesses.controller';
import { TerminalsController } from '../terminals.controller';

const mockFn = () => jest.fn<(...args: any[]) => any>();
const asUser = (fields: Partial<AuthenticatedUser>): AuthenticatedUser => ({
  subjectId: fields.userId ?? 'subject',
  permissions: [],
  ...fields,
});
const handlerOf = (controller: object, name: string): unknown =>
  Object.getOwnPropertyDescriptor(controller, name)?.value;

describe('businesses controllers', () => {
  const service = {
    getBusinessProfile: mockFn(),
    getBranchDetails: mockFn(),
    listBranches: mockFn(),
    updateBusinessProfile: mockFn(),
    activateTerminal: mockFn(),
  };
  const businesses = new BusinessesController(service as never);
  const branches = new BranchesController(service as never);
  const terminals = new TerminalsController(service as never);
  const businessId = '00000000-0000-4000-8000-000000000001';

  beforeEach(() => jest.clearAllMocks());

  it('registers the business read permission key', () => {
    expect(
      Reflect.getMetadata(
        REQUIRED_ROLES,
        handlerOf(BusinessesController.prototype, 'getBusiness') as object,
      ),
    ).toBe('business.read');
  });

  it('returns the profile for the owner of the requested business', async () => {
    const profile = { id: businessId, isActive: false };
    const user = asUser({ isOwner: true, businessId });
    service.getBusinessProfile.mockResolvedValue(profile);
    await expect(businesses.getBusiness({ businessId }, user)).resolves.toBe(
      profile,
    );
    expect(service.getBusinessProfile).toHaveBeenCalledWith(businessId, user);
  });

  it.each([
    ['non-owner', asUser({ isOwner: false, businessId })],
    [
      'different business',
      asUser({
        isOwner: true,
        businessId: '00000000-0000-4000-8000-000000000002',
      }),
    ],
    ['platform owner', asUser({ isOwner: true, isPlatform: true, businessId })],
    ['anonymous', undefined],
  ])('denies %s access', (_description, user) => {
    expect(() => businesses.getBusiness({ businessId }, user)).toThrow(
      ForbiddenException,
    );
    expect(service.getBusinessProfile).not.toHaveBeenCalled();
  });

  it('routes an authorized owner update with files and audit context', async () => {
    const result = { businessId, updatedAt: '2026-02-01T00:00:00.000Z' };
    service.updateBusinessProfile.mockResolvedValue(result);
    const user = asUser({ isOwner: true, businessId, userId: 'owner-id' });
    const dto = { reason: 'Approved operation', displayName: 'New name' };
    const files = { panCardFront: [{ originalname: 'front.pdf' }] };
    const headers = { idempotencyKey: 'key-1', clientType: 'desktop' };
    const auditContext = { method: 'PATCH', clientType: 'desktop' };

    await expect(
      businesses.updateBusiness(
        { businessId },
        dto,
        headers,
        files as never,
        user,
        auditContext,
      ),
    ).resolves.toBe(result);
    expect(service.updateBusinessProfile).toHaveBeenCalledWith(
      businessId,
      user,
      dto,
      files,
      'key-1',
      auditContext,
    );
  });

  it('registers the business update permission key', () => {
    expect(
      Reflect.getMetadata(
        REQUIRED_ROLES,
        handlerOf(BusinessesController.prototype, 'updateBusiness') as object,
      ),
    ).toBe('business.update');
  });

  it('registers branch read as fail-closed role access', () => {
    const handler = handlerOf(
      BranchesController.prototype,
      'listBranches',
    ) as object;
    expect(Reflect.getMetadata(REQUIRED_ROLES, handler)).toBe('branches.read');
    expect(Reflect.getMetadata(REQUIRE_CONFIGURED_ROLES, handler)).toBe(true);
  });

  it('routes branch listing for the authenticated business user', async () => {
    const response = { items: [], nextCursor: null };
    service.listBranches.mockResolvedValue(response);
    const user = asUser({ isOwner: false, businessId, userId: 'user-id' });
    await expect(
      branches.listBranches({ businessId }, { limit: 50 }, user),
    ).resolves.toBe(response);
    expect(service.listBranches).toHaveBeenCalledWith(businessId, user, {
      limit: 50,
    });
  });

  it('denies branch reads to platform users and other businesses', () => {
    expect(() =>
      branches.listBranches(
        { businessId },
        { limit: 50 },
        asUser({ isPlatform: true, businessId }),
      ),
    ).toThrow(ForbiddenException);
    expect(() =>
      branches.getBranch(
        { businessId, branchId: businessId },
        asUser({ businessId: '00000000-0000-4000-8000-000000000009' }),
      ),
    ).toThrow(ForbiddenException);
    expect(service.listBranches).not.toHaveBeenCalled();
    expect(service.getBranchDetails).not.toHaveBeenCalled();
  });

  it('registers branch detail read as fail-closed role access', () => {
    const handler = handlerOf(
      BranchesController.prototype,
      'getBranch',
    ) as object;
    expect(Reflect.getMetadata(REQUIRED_ROLES, handler)).toBe('branches.read');
    expect(Reflect.getMetadata(REQUIRE_CONFIGURED_ROLES, handler)).toBe(true);
  });

  it('routes branch detail requests with the authenticated user', async () => {
    const response = { branch: { id: businessId }, summary: {} };
    const branchId = '00000000-0000-4000-8000-000000000002';
    const user = asUser({ isOwner: false, businessId, userId: 'user-id' });
    service.getBranchDetails.mockResolvedValue(response);
    await expect(
      branches.getBranch({ businessId, branchId }, user),
    ).resolves.toBe(response);
    expect(service.getBranchDetails).toHaveBeenCalledWith(
      businessId,
      branchId,
      user,
    );
  });

  it('normalises the terminal code and requires the owner to activate', async () => {
    const branchId = '00000000-0000-4000-8000-000000000002';
    const owner = asUser({ isOwner: true, businessId, userId: 'owner-id' });
    service.activateTerminal.mockResolvedValue({ status: 'active' });

    await terminals.activateTerminal(
      { businessId, branchId },
      { terminalCode: ' pos-abc ' },
      owner,
      {},
    );
    expect(service.activateTerminal).toHaveBeenCalledWith(
      businessId,
      branchId,
      'POS-ABC',
      owner,
      {},
    );

    expect(() =>
      terminals.activateTerminal(
        { businessId, branchId },
        { terminalCode: 'POS-ABC' },
        asUser({ isOwner: false, businessId }),
        {},
      ),
    ).toThrow(ForbiddenException);
  });
});
