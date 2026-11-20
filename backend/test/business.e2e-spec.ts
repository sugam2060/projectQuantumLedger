import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import {
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { PermissionGuard } from '../src/authentication/guards/permission.guard';
import type { AuthenticatedUser } from '../src/authentication/strategies/jwt.strategy';
import { BusinessController } from '../src/business/business.controller';
import { BusinessService } from '../src/business/business.service';
import { EndpointAccessService } from '../src/roles-permissions/endpoint-access.service';

describe('BusinessController endpoints (e2e)', () => {
  let app: INestApplication;
  const businessId = '00000000-0000-4000-8000-000000000001';
  const branchId = '00000000-0000-4000-8000-000000000002';
  const businessService = {
    getBusinessProfile: jest.fn(),
    updateBusinessProfile: jest.fn(),
    listBranches: jest.fn(),
    getBranchDetails: jest.fn(),
  };
  const endpointAccess = { hasAccess: jest.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [BusinessController],
      providers: [{ provide: BusinessService, useValue: businessService }],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        validateCustomDecorators: true,
      }),
    );
    app.use(
      (
        req: Request & { user?: AuthenticatedUser },
        _res: Response,
        next: NextFunction,
      ) => {
        req.user = {
          subjectId: '00000000-0000-4000-8000-000000000003',
          userId: '00000000-0000-4000-8000-000000000003',
          businessId,
          branchId: req.header('x-test-branch-id') ?? undefined,
          isOwner: req.header('x-test-owner') === 'true',
          isPlatform: false,
          permissions: [],
        };
        next();
      },
    );
    app.useGlobalGuards(
      new PermissionGuard(module.get(Reflector), endpointAccess as never),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    endpointAccess.hasAccess.mockResolvedValue(true);
    businessService.getBusinessProfile.mockResolvedValue({
      id: businessId,
      displayName: 'Example Retail',
      isActive: true,
    });
    businessService.listBranches.mockResolvedValue({
      items: [
        {
          id: branchId,
          name: 'Main Branch',
          status: 'active',
        },
      ],
      nextCursor: null,
    });
    businessService.getBranchDetails.mockResolvedValue({
      branch: {
        id: branchId,
        businessId,
        name: 'Main Branch',
        status: 'active',
      },
      summary: {
        terminals: { active: 1, inactive: 0, maintenance: 0, total: 1 },
        members: { active: 1, inactive: 0, total: 1 },
      },
    });
    businessService.updateBusinessProfile.mockResolvedValue({
      businessId,
      updatedAt: '2026-11-20T00:00:00.000Z',
      changedFields: { displayName: 'Updated Retail' },
    });
  });

  it('reads a business profile only for its owner', async () => {
    await request(app.getHttpServer())
      .get(`/businesses/${businessId}`)
      .set('x-test-owner', 'true')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: businessId,
          displayName: 'Example Retail',
        });
      });

    await request(app.getHttpServer())
      .get(`/businesses/${businessId}`)
      .expect(403);
    expect(businessService.getBusinessProfile).toHaveBeenCalledTimes(1);
  });

  it('lists branches for an owner or a member with branches.read access', async () => {
    await request(app.getHttpServer())
      .get(`/businesses/${businessId}/branches?limit=10`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items[0]).toMatchObject({ id: branchId, status: 'active' });
        expect(body.nextCursor).toBeNull();
      });
    expect(endpointAccess.hasAccess).toHaveBeenCalledWith(
      expect.objectContaining({ userId: expect.any(String) }),
      'branches.read',
      { requireConfiguration: true },
    );
    expect(businessService.listBranches).toHaveBeenCalledWith(
      businessId,
      expect.objectContaining({ branchId: undefined }),
      expect.objectContaining({ limit: 10 }),
    );

    businessService.listBranches.mockClear();
    await request(app.getHttpServer())
      .get(`/businesses/${businessId}/branches`)
      .set('x-test-owner', 'true')
      .expect(200);
    expect(endpointAccess.hasAccess).toHaveBeenCalledTimes(1);
    expect(businessService.listBranches).toHaveBeenCalledTimes(1);
  });

  it('denies branch listing when the role check fails', async () => {
    endpointAccess.hasAccess.mockResolvedValue(false);
    await request(app.getHttpServer())
      .get(`/businesses/${businessId}/branches`)
      .expect(403);
    expect(businessService.listBranches).not.toHaveBeenCalled();
  });

  it('reads branch details for an authorized branch-scoped member', async () => {
    await request(app.getHttpServer())
      .get(`/businesses/${businessId}/branches/${branchId}`)
      .set('x-test-branch-id', branchId)
      .expect(200)
      .expect(({ body }) => {
        expect(body.branch).toMatchObject({ id: branchId, status: 'active' });
        expect(body.summary.terminals.total).toBe(1);
        expect(body.summary.members.total).toBe(1);
      });
    expect(endpointAccess.hasAccess).toHaveBeenCalledWith(
      expect.objectContaining({ branchId }),
      'branches.read',
      { requireConfiguration: true },
    );
    expect(businessService.getBranchDetails).toHaveBeenCalledWith(
      businessId,
      branchId,
      expect.objectContaining({ branchId }),
    );
  });

  it('returns 404 for an out-of-scope branch and validates branch UUIDs', async () => {
    businessService.getBranchDetails.mockRejectedValueOnce(
      new NotFoundException('Branch was not found'),
    );
    await request(app.getHttpServer())
      .get(`/businesses/${businessId}/branches/${branchId}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/businesses/${businessId}/branches/not-a-uuid`)
      .set('x-test-owner', 'true')
      .expect(400);
  });

  it('updates permitted profile fields for the owner and rejects sensitive fields', async () => {
    await request(app.getHttpServer())
      .patch(`/businesses/${businessId}`)
      .set('x-test-owner', 'true')
      .set('x-client-type', 'desktop')
      .set('idempotency-key', 'business-update-e2e-001')
      .field('reason', 'Approved display name update')
      .field('displayName', 'Updated Retail')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          businessId,
          changedFields: { displayName: 'Updated Retail' },
        });
      });

    expect(businessService.updateBusinessProfile).toHaveBeenCalledWith(
      businessId,
      expect.objectContaining({ isOwner: true }),
      expect.objectContaining({ displayName: 'Updated Retail' }),
      {},
      'business-update-e2e-001',
      expect.objectContaining({ method: 'PATCH' }),
    );

    await request(app.getHttpServer())
      .patch(`/businesses/${businessId}`)
      .set('x-test-owner', 'true')
      .set('x-client-type', 'desktop')
      .set('idempotency-key', 'business-update-e2e-002')
      .field('reason', 'Attempted sensitive update')
      .field('isActive', 'false')
      .expect(422);
  });
});
