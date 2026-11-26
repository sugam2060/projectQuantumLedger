import {
  findUnprotectedRoutes,
  type AuditedRoute,
} from '../utils/route-audit.util';

const route = (fields: Partial<AuditedRoute>): AuditedRoute => ({
  method: 'GET',
  path: '/x',
  isPublic: false,
  isPlatform: false,
  permissions: [],
  platformPermissions: [],
  ...fields,
});

const problems = (routes: AuditedRoute[]) =>
  findUnprotectedRoutes(routes).map((finding) => finding.problem);

describe('findUnprotectedRoutes', () => {
  it('accepts correctly protected routes', () => {
    expect(
      problems([
        route({
          path: '/businesses/:businessId',
          permissions: ['business:read'],
        }),
        route({ path: '/authentication/me' }),
        route({ path: '/', isPublic: true }),
        route({
          path: '/platform',
          isPlatform: true,
          platformPermissions: ['platform:business:read'],
        }),
        route({
          path: '/platform/user/logout-all',
          isPlatform: true,
          isSelfService: true,
        }),
      ]),
    ).toEqual([]);
  });

  it('flags tenant routes without a permission', () => {
    expect(
      problems([route({ path: '/businesses/:businessId/roles' })]),
    ).toEqual(['tenant route without @RequiredPermission']);
  });

  it('does not mistake similar parameter names for :businessId', () => {
    expect(problems([route({ path: '/x/:businessIdentifier' })])).toEqual([]);
  });

  it('flags platform routes without a platform permission', () => {
    expect(
      problems([route({ path: '/platform/x', isPlatform: true })]),
    ).toEqual(['platform route without @RequiredPlatformPermission']);
  });

  it('flags permissions on the wrong kind of route', () => {
    expect(
      problems([
        route({
          path: '/platform/x',
          isPlatform: true,
          platformPermissions: ['platform:business:read'],
          permissions: ['business:read'],
        }),
        route({ path: '/me', platformPermissions: ['platform:business:read'] }),
        route({
          path: '/invite/:businessId',
          isPublic: true,
          permissions: ['member:invite'],
        }),
      ]),
    ).toEqual([
      'platform route with a business permission',
      'business route with a platform permission',
      'public route with :businessId',
      'public route with a permission requirement',
    ]);
  });
});
