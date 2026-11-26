import type { TestingModule } from '@nestjs/testing';
import {
  IS_SELF_SERVICE_KEY,
  REQUIRED_PERMISSIONS_KEY,
  REQUIRED_PLATFORM_PERMISSIONS_KEY,
} from '../../src/authorization';
import { findUnprotectedRoutes } from '../../src/authorization/utils/route-audit.util';
import { IS_PLATFORM_ROUTE_KEY } from '../../src/common/decorators/platform-route.decorator';
import { IS_PUBLIC_KEY } from '../../src/common/decorators/public.decorator';
import {
  collectRoutes,
  compileAppForRoutes,
} from '../common/helpers/collect-routes';

/**
 * Fails when a route's protection does not match its shape: every tenant route
 * (`:businessId`) needs @RequiredPermission and every @PlatformRoute() needs
 * @RequiredPlatformPermission. New routes cannot ship unprotected by accident.
 */
describe('Route audit', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await compileAppForRoutes();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('finds no unprotected or mis-protected routes', () => {
    const routes = collectRoutes(moduleRef).map((route) => ({
      method: route.method,
      path: route.path,
      isPublic: route.metadata(IS_PUBLIC_KEY) === true,
      isPlatform: route.metadata(IS_PLATFORM_ROUTE_KEY) === true,
      isSelfService: route.metadata(IS_SELF_SERVICE_KEY) === true,
      permissions: (route.metadata(REQUIRED_PERMISSIONS_KEY) ?? []) as string[],
      platformPermissions: (route.metadata(REQUIRED_PLATFORM_PERMISSIONS_KEY) ??
        []) as string[],
    }));
    expect(routes.length).toBeGreaterThan(10);
    expect(
      findUnprotectedRoutes(routes).map(
        (finding) => `${finding.method} ${finding.path}: ${finding.problem}`,
      ),
    ).toEqual([]);
  });
});
