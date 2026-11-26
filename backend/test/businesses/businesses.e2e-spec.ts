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
import { PermissionGuard } from '../../src/authorization';
import type { AuthenticatedUser } from '../../src/common/types';
import { BranchesController } from '../../src/businesses/branches.controller';
import { BranchesService } from '../../src/businesses/branches.service';
import { BusinessesController } from '../../src/businesses/businesses.controller';
import { BusinessesService } from '../../src/businesses/businesses.service';
import { TerminalsController } from '../../src/businesses/terminals.controller';
import { TerminalsService } from '../../src/businesses/terminals.service';

describe('Businesses endpoints (e2e)', () => {
  let app: INestApplication;
  const businessId = '00000000-0000-4000-8000-000000000001';
  const branchId = '00000000-0000-4000-8000-000000000002';
  const businessService = {
    getBusinessProfile: jest.fn(),
    updateBusinessProfile: jest.fn(),
    listBranches: jest.fn(),
    getBranchDetails: jest.fn(),
    activateTerminal: jest.fn(),
  };
  const permissions = { hasAll: jest.fn(), platformHasAll: jest.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        BusinessesController,
        BranchesController,
        TerminalsController,
      ],
      providers: [
        { provide: BusinessesService, useValue: businessService },
        { provide: BranchesService, useValue: businessService },
        { provide: TerminalsService, useValue: businessService },
      ],
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
          isOwner: false,
          isPlatform: false,
          permissions: [],
        };
        next();
      },
    );
    app.useGlobalGuards(
      new PermissionGuard(module.get(Reflector), permissions as never),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    permissions.hasAll.mockResolvedValue(true);
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
    businessService.activateTerminal.mockResolvedValue({
      id: 'terminal-id',
      name: 'Front Counter',
      terminalCode: 'POS-A1B2C3D4E5F60718',
      status: 'active',
    });
    businessService.updateBusinessProfile.mockResolvedValue({
      businessId,
      updatedAt: '2026-11-20T00:00:00.000Z',
      changedFields: { displayName: 'Updated Retail' },
    });
  });

  const userId = '00000000-0000-4000-8000-000000000003';

  it('reads a business profile when business:read is granted', async () => {
    await request(app.getHttpServer())
      .get(`/businesses/${businessId}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ id: businessId });
      });
    expect(permissions.hasAll).toHaveBeenCalledWith(
      userId,
      businessId,
      undefined,
      ['business:read'],
    );

    permissions.hasAll.mockResolvedValue(false);
    await request(app.getHttpServer())
      .get(`/businesses/${businessId}`)
      .expect(403)
      .expect(({ body }) =>
        expect(body.message).toBe('You do not have permission for this action'),
      );
    expect(businessService.getBusinessProfile).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed business id with 400 before any permission check', async () => {
    await request(app.getHttpServer())
      .get('/businesses/not-a-uuid')
      .expect(400);
    expect(permissions.hasAll).not.toHaveBeenCalled();
  });

  it('lists branches with branch:read', async () => {
    await request(app.getHttpServer())
      .get(`/businesses/${businessId}/branches?limit=10`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items[0]).toMatchObject({ id: branchId, status: 'active' });
      });
    expect(permissions.hasAll).toHaveBeenCalledWith(
      userId,
      businessId,
      undefined,
      ['branch:read'],
    );
    expect(businessService.listBranches).toHaveBeenCalledWith(
      businessId,
      expect.objectContaining({ userId }),
      expect.objectContaining({ limit: 10 }),
    );
  });

  it('checks branch-scoped permissions at the requested branch', async () => {
    await request(app.getHttpServer())
      .get(`/businesses/${businessId}/branches/${branchId}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.summary.terminals.total).toBe(1);
      });
    expect(permissions.hasAll).toHaveBeenCalledWith(
      userId,
      businessId,
      branchId,
      ['branch:read'],
    );
    await request(app.getHttpServer())
      .get(`/businesses/${businessId}/branches/not-a-uuid`)
      .expect(400);
  });

  it('returns 404 from the service for an out-of-scope branch', async () => {
    businessService.getBranchDetails.mockRejectedValueOnce(
      new NotFoundException('Branch was not found'),
    );
    await request(app.getHttpServer())
      .get(`/businesses/${businessId}/branches/${branchId}`)
      .expect(404);
  });

  it('activates a terminal only with terminal:activate at that branch', async () => {
    permissions.hasAll.mockResolvedValue(false);
    await request(app.getHttpServer())
      .post(`/businesses/${businessId}/branches/${branchId}/terminals/activate`)
      .send({ terminalCode: 'pos-a1b2c3d4e5f60718' })
      .expect(403);
    expect(businessService.activateTerminal).not.toHaveBeenCalled();

    permissions.hasAll.mockResolvedValue(true);
    await request(app.getHttpServer())
      .post(`/businesses/${businessId}/branches/${branchId}/terminals/activate`)
      .send({ terminalCode: 'pos-a1b2c3d4e5f60718' })
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('active'));
    expect(permissions.hasAll).toHaveBeenLastCalledWith(
      userId,
      businessId,
      branchId,
      ['terminal:activate'],
    );
    expect(businessService.activateTerminal).toHaveBeenCalledWith(
      businessId,
      branchId,
      'POS-A1B2C3D4E5F60718',
      expect.objectContaining({ userId }),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('updates permitted profile fields and rejects sensitive fields', async () => {
    await request(app.getHttpServer())
      .patch(`/businesses/${businessId}`)
      .set('x-client-type', 'desktop')
      .set('idempotency-key', 'business-update-e2e-001')
      .field('reason', 'Approved display name update')
      .field('displayName', 'Updated Retail')
      .expect(200);
    expect(permissions.hasAll).toHaveBeenCalledWith(
      userId,
      businessId,
      undefined,
      ['business:update'],
    );
    expect(businessService.updateBusinessProfile).toHaveBeenCalledWith(
      businessId,
      expect.objectContaining({ userId }),
      expect.objectContaining({ displayName: 'Updated Retail' }),
      {},
      'business-update-e2e-001',
      expect.objectContaining({ method: 'PATCH' }),
    );

    await request(app.getHttpServer())
      .patch(`/businesses/${businessId}`)
      .set('x-client-type', 'desktop')
      .set('idempotency-key', 'business-update-e2e-002')
      .field('reason', 'Attempted sensitive update')
      .field('isActive', 'false')
      .expect(422);
  });
});
