/** What the route audit needs to know about one route. */
export type AuditedRoute = {
  method: string;
  path: string;
  isPublic: boolean;
  isPlatform: boolean;
  /** `@SelfService()`: acts only on the caller's own account. */
  isSelfService?: boolean;
  permissions: readonly string[];
  platformPermissions: readonly string[];
};

export type RouteFinding = AuditedRoute & { problem: string };

/**
 * Routes whose protection does not match their shape:
 * - a tenant route (`:businessId`) without `@RequiredPermission`
 * - a public route that names a business or carries a permission
 * - a `@PlatformRoute()` without `@RequiredPlatformPermission` (unless it is
 *   `@SelfService()`)
 * - a business permission on a platform route, or the other way round
 */
export function findUnprotectedRoutes(
  routes: readonly AuditedRoute[],
): RouteFinding[] {
  const findings: RouteFinding[] = [];
  for (const route of routes) {
    const tenant = /(^|\/):businessId(\/|$)/.test(route.path);
    const flag = (problem: string) => findings.push({ ...route, problem });

    if (route.isPublic) {
      if (tenant) flag('public route with :businessId');
      if (route.permissions.length || route.platformPermissions.length) {
        flag('public route with a permission requirement');
      }
      continue;
    }
    if (route.isPlatform) {
      if (!route.platformPermissions.length && !route.isSelfService) {
        flag('platform route without @RequiredPlatformPermission');
      }
      if (route.permissions.length) {
        flag('platform route with a business permission');
      }
      continue;
    }
    if (route.platformPermissions.length) {
      flag('business route with a platform permission');
    }
    if (tenant && !route.permissions.length) {
      flag('tenant route without @RequiredPermission');
    }
  }
  return findings;
}
