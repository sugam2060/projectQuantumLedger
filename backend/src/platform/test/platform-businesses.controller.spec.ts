import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { THROTTLE_OVERRIDE_KEY } from '../../common/throttling/throttling.constants';
import type { AuthenticatedUser } from '../../common/types';
import { PlatformBusinessesController } from '../platform-businesses.controller';
import { PlatformBusinessesService } from '../platform-businesses.service';

const platformUser = (
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser => ({
  subjectId: 'platform-user-id',
  isPlatform: true,
  platformUserId: 'platform-user-id',
  permissions: [],
  ...overrides,
});
const businessUser: AuthenticatedUser = {
  subjectId: 'user-id',
  isPlatform: false,
  permissions: [],
};

describe('PlatformBusinessesController', () => {
  const platformBusiness = {
    provisionBusiness: jest.fn(),
    getBusinessDetails: jest.fn(),
    getBranchDetails: jest.fn(),
    createBranch: jest.fn(),
    listBusinesses: jest.fn(),
  };
  let controller: PlatformBusinessesController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [PlatformBusinessesController],
      providers: [
        { provide: PlatformBusinessesService, useValue: platformBusiness },
      ],
    }).compile();
    controller = module.get(PlatformBusinessesController);
  });

  it('allows only platform users to read business details', async () => {
    const result = {
      business: { id: '00000000-0000-4000-8000-000000000010' },
      branches: [],
      memberships: [],
    };
    platformBusiness.getBusinessDetails.mockResolvedValue(result);

    await expect(
      controller.getBusiness(
        '00000000-0000-4000-8000-000000000010',
        'mobile',
        platformUser(),
      ),
    ).resolves.toBe(result);
    expect(platformBusiness.getBusinessDetails).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000010',
      'platform-user-id',
    );

    await expect(
      controller.getBusiness(
        '00000000-0000-4000-8000-000000000010',
        'mobile',
        businessUser,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires a valid x-client-type when reading details', async () => {
    await expect(
      controller.getBusiness(
        '00000000-0000-4000-8000-000000000010',
        undefined,
        platformUser(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.getBranch(
        '00000000-0000-4000-8000-000000000010',
        '00000000-0000-4000-8000-000000000011',
        'tablet',
        platformUser(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(platformBusiness.getBusinessDetails).not.toHaveBeenCalled();
    expect(platformBusiness.getBranchDetails).not.toHaveBeenCalled();
  });

  it('allows platform users to read branch details for a business', async () => {
    const result = {
      branch: { id: '00000000-0000-4000-8000-000000000011' },
      activeEmployeeCount: 2,
      terminals: [],
      terminalCounts: { total: 0, active: 0, inactive: 0, maintenance: 0 },
    };
    platformBusiness.getBranchDetails.mockResolvedValue(result);

    await expect(
      controller.getBranch(
        '00000000-0000-4000-8000-000000000010',
        '00000000-0000-4000-8000-000000000011',
        'desktop',
        platformUser(),
      ),
    ).resolves.toBe(result);
    expect(platformBusiness.getBranchDetails).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000010',
      '00000000-0000-4000-8000-000000000011',
      'platform-user-id',
    );

    await expect(
      controller.getBranch(
        '00000000-0000-4000-8000-000000000010',
        '00000000-0000-4000-8000-000000000011',
        'desktop',
        businessUser,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lists businesses only for authenticated platform users', async () => {
    const result = {
      data: [{ id: 'business-id', isActive: false }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    };
    platformBusiness.listBusinesses.mockResolvedValue(result);
    const handler = Reflect.get(
      PlatformBusinessesController.prototype,
      'listBusinesses',
    );

    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).not.toBe(true);
    await expect(
      controller.listBusinesses(
        { page: 1, limit: 20 },
        { clientType: 'web' },
        platformUser(),
      ),
    ).resolves.toBe(result);
    expect(platformBusiness.listBusinesses).toHaveBeenCalledWith(
      { page: 1, limit: 20 },
      'platform-user-id',
    );

    await expect(
      controller.listBusinesses(
        { page: 1, limit: 20 },
        { clientType: 'web' },
        businessUser,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(platformBusiness.listBusinesses).toHaveBeenCalledTimes(1);
  });

  it('protects the provisioning route and delegates request, body, key, and actor', async () => {
    const result = { businessId: 'business-id' };
    platformBusiness.provisionBusiness.mockResolvedValue(result);
    const query = { requested_business_id: 'request-id' };
    const body = { pan: 'ABCDE1234F' };
    const headers = { clientType: 'web', idempotencyKey: 'request-1' };
    const auditContext = {
      method: 'POST',
      endpointPath: '/platform/businesses/create',
    };
    const handler = PlatformBusinessesController.prototype.provisionBusiness;

    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).not.toBe(true);
    expect(Reflect.getMetadata(THROTTLE_OVERRIDE_KEY, handler)).toEqual(
      expect.objectContaining({ limit: 20 }),
    );
    await expect(
      controller.provisionBusiness(
        query as never,
        body,
        headers as never,
        platformUser(),
        auditContext,
      ),
    ).resolves.toBe(result);
    expect(platformBusiness.provisionBusiness).toHaveBeenCalledWith(
      'request-id',
      body,
      'request-1',
      'platform-user-id',
      auditContext,
    );
  });

  it('uses the verified JWT subject when the platformUserId mapping is absent', async () => {
    await controller.provisionBusiness(
      { requested_business_id: 'request-id' } as never,
      { pan: 'ABCDE1234F' },
      { idempotencyKey: 'request-1' } as never,
      platformUser({
        platformUserId: undefined,
        subjectId: '00000000-0000-4000-8000-000000000009',
      }),
      {},
    );

    expect(platformBusiness.provisionBusiness).toHaveBeenCalledWith(
      'request-id',
      { pan: 'ABCDE1234F' },
      'request-1',
      '00000000-0000-4000-8000-000000000009',
      expect.any(Object),
    );
  });

  it('does not allow a non-platform JWT to provision a business', async () => {
    await expect(
      controller.provisionBusiness(
        { requested_business_id: 'request-id' } as never,
        { pan: 'ABCDE1234F' },
        { idempotencyKey: 'request-1' } as never,
        {
          ...businessUser,
          platformUserId: '00000000-0000-4000-8000-000000000009',
        },
        {},
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(platformBusiness.provisionBusiness).not.toHaveBeenCalled();
  });

  it('creates branches only for platform users and forwards the audit context', async () => {
    const result = {
      branch: { id: 'branch-id', name: 'Main Branch' },
      terminals: [],
    };
    platformBusiness.createBranch.mockResolvedValue(result);
    const auditContext = {
      method: 'POST',
      endpointPath: '/platform/businesses/:businessId/branches',
    };
    const handler = PlatformBusinessesController.prototype.createBranch;

    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).not.toBe(true);
    await expect(
      controller.createBranch(
        { businessId: 'business-id' } as never,
        { name: 'Main Branch', code: 'MAIN' },
        { clientType: 'web', idempotencyKey: 'key-1' },
        platformUser(),
        auditContext,
      ),
    ).resolves.toBe(result);
    expect(platformBusiness.createBranch).toHaveBeenCalledWith(
      'business-id',
      { name: 'Main Branch', code: 'MAIN' },
      'key-1',
      'platform-user-id',
      auditContext,
    );

    await expect(
      controller.createBranch(
        { businessId: 'business-id' } as never,
        { name: 'Main Branch', code: 'MAIN' },
        { clientType: 'web', idempotencyKey: 'key-2' },
        businessUser,
        {},
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(platformBusiness.createBranch).toHaveBeenCalledTimes(1);
  });
});
