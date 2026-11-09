import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PermissionGuard } from '../src/authentication/guards/permission.guard';
import { RequiredRoles } from '../src/authentication/decorators/required_permission.decorator';
import { EndpointAccessService } from '../src/roles-permissions/endpoint-access.service';
import { EndpointAccessCatalogService } from '../src/roles-permissions/endpoint-access-catalog.service';
import { RolesPermissionsController } from '../src/roles-permissions/roles-permissions.controller';
import type { AuthenticatedUser } from '../src/authentication/strategies/jwt.strategy';
import { Controller, Get } from '@nestjs/common';

class TestSessionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: AuthenticatedUser;
    }>();
    request.user = {
      userId: request.headers['x-test-user'] ?? 'user-1',
      businessId: '00000000-0000-4000-8000-000000000001',
      isOwner: request.headers['x-test-owner'] === 'true',
      permissions: [],
    };
    return true;
  }
}

@Controller('test/role-protected')
class RoleProtectedController {
  @Get()
  @RequiredRoles('inventory.create')
  getProtectedResource() {
    return { allowed: true };
  }
}

describe('Roles and permissions endpoint access (e2e)', () => {
  let app: INestApplication;
  const endpointAccess = {
    listConfigurations: jest.fn(),
    setRequiredRoles: jest.fn(),
    clearRequiredRoles: jest.fn(),
    hasAccess: jest.fn(),
  };
  const catalog = {
    list: jest.fn(),
    has: jest.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [RolesPermissionsController, RoleProtectedController],
      providers: [
        { provide: EndpointAccessService, useValue: endpointAccess },
        { provide: EndpointAccessCatalogService, useValue: catalog },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalGuards(
      new TestSessionGuard(),
      new PermissionGuard(module.get(Reflector), endpointAccess as never),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    endpointAccess.listConfigurations.mockResolvedValue([
      {
        endpointKey: 'inventory.create',
        roleIds: ['00000000-0000-4000-8000-000000000002'],
      },
    ]);
    endpointAccess.setRequiredRoles.mockImplementation(
      async (_user, endpointKey, roleIds) => ({ endpointKey, roleIds }),
    );
    endpointAccess.clearRequiredRoles.mockResolvedValue(undefined);
    endpointAccess.hasAccess.mockResolvedValue(true);
    catalog.list.mockReturnValue([
      {
        endpointKey: 'inventory.create',
        controller: 'InventoryController',
        method: 'POST',
        path: '/inventory',
      },
    ]);
    catalog.has.mockReturnValue(true);
  });

  it('lists configured endpoint roles for the authenticated owner', async () => {
    await request(app.getHttpServer())
      .get('/business/endpoint-access')
      .set('x-test-owner', 'true')
      .expect(200)
      .expect(({ body }) => {
        expect(body[0].endpointKey).toBe('inventory.create');
      });
  });

  it('exposes endpoint keys annotated for dynamic role configuration', async () => {
    await request(app.getHttpServer())
      .get('/business/endpoint-access/endpoints')
      .expect(200)
      .expect(({ body }) => {
        expect(body[0].endpointKey).toBe('inventory.create');
      });
  });

  it('validates role IDs before saving endpoint configuration', async () => {
    await request(app.getHttpServer())
      .put('/business/endpoint-access/inventory.create')
      .set('x-test-owner', 'true')
      .send({ roleIds: ['not-a-uuid'] })
      .expect(400);

    expect(endpointAccess.setRequiredRoles).not.toHaveBeenCalled();
  });

  it('saves a valid endpoint role configuration', async () => {
    await request(app.getHttpServer())
      .put('/business/endpoint-access/inventory.create')
      .set('x-test-owner', 'true')
      .send({ roleIds: ['00000000-0000-4000-8000-000000000002'] })
      .expect(200)
      .expect(({ body }) => {
        expect(body.endpointKey).toBe('inventory.create');
      });
  });

  it('rejects endpoint keys that are not registered by a decorated handler', async () => {
    catalog.has.mockReturnValueOnce(false);

    await request(app.getHttpServer())
      .put('/business/endpoint-access/not.registered')
      .set('x-test-owner', 'true')
      .send({ roleIds: ['00000000-0000-4000-8000-000000000002'] })
      .expect(400);

    expect(endpointAccess.setRequiredRoles).not.toHaveBeenCalled();
  });

  it('applies the configured dynamic role check to decorated endpoints', async () => {
    await request(app.getHttpServer()).get('/test/role-protected').expect(200);
    expect(endpointAccess.hasAccess).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      'inventory.create',
    );

    endpointAccess.hasAccess.mockResolvedValueOnce(false);
    await request(app.getHttpServer()).get('/test/role-protected').expect(403);
  });
});
