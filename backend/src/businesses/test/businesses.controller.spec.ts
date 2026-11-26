import { jest } from '@jest/globals';
import {
  Permission,
  REQUIRED_PERMISSIONS_KEY,
  type PermissionKey,
} from '../../authorization';
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
const requiredFor = (
  controller: { prototype: object },
  name: string,
): PermissionKey[] | undefined =>
  Reflect.getMetadata(
    REQUIRED_PERMISSIONS_KEY,
    Object.getOwnPropertyDescriptor(controller.prototype, name)
      ?.value as object,
  );

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
  const branchId = '00000000-0000-4000-8000-000000000002';
  const user = asUser({ businessId, userId: 'user-id' });

  beforeEach(() => jest.clearAllMocks());

  it.each([
    [BusinessesController, 'getBusiness', Permission.BUSINESS_READ],
    [BusinessesController, 'updateBusiness', Permission.BUSINESS_UPDATE],
    [BranchesController, 'listBranches', Permission.BRANCH_READ],
    [BranchesController, 'getBranch', Permission.BRANCH_READ],
    [TerminalsController, 'activateTerminal', Permission.TERMINAL_ACTIVATE],
  ] as const)('%p.%s requires %s', (controller, handler, permission) => {
    expect(requiredFor(controller, handler)).toEqual([permission]);
  });

  it('passes the authorized business to the profile read', async () => {
    const profile = { id: businessId };
    service.getBusinessProfile.mockResolvedValue(profile);
    await expect(businesses.getBusiness(businessId, user)).resolves.toBe(
      profile,
    );
    expect(service.getBusinessProfile).toHaveBeenCalledWith(businessId, user);
  });

  it('routes an update with files, idempotency key and audit context', async () => {
    const result = { businessId };
    service.updateBusinessProfile.mockResolvedValue(result);
    const dto = { reason: 'Approved operation', displayName: 'New name' };
    const files = { panCardFront: [{ originalname: 'front.pdf' }] };
    const auditContext = { method: 'PATCH', clientType: 'desktop' };

    await expect(
      businesses.updateBusiness(
        businessId,
        dto,
        { idempotencyKey: 'key-1', clientType: 'desktop' },
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

  it('routes branch listing and detail reads', async () => {
    service.listBranches.mockResolvedValue({ items: [] });
    service.getBranchDetails.mockResolvedValue({ branch: {} });
    await branches.listBranches(businessId, { limit: 50 }, user);
    await branches.getBranch(businessId, branchId, user);
    expect(service.listBranches).toHaveBeenCalledWith(businessId, user, {
      limit: 50,
    });
    expect(service.getBranchDetails).toHaveBeenCalledWith(
      businessId,
      branchId,
      user,
    );
  });

  it('normalises the terminal code before activation', async () => {
    service.activateTerminal.mockResolvedValue({ status: 'active' });
    await terminals.activateTerminal(
      businessId,
      branchId,
      { terminalCode: ' pos-abc ' },
      user,
      {},
    );
    expect(service.activateTerminal).toHaveBeenCalledWith(
      businessId,
      branchId,
      'POS-ABC',
      user,
      {},
    );
  });
});
