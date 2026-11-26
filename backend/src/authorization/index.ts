export { AuthorizationModule } from './authorization.module';
export { PermissionService } from './permission.service';
export { PermissionGuard, PERMISSION_DENIED } from './guards/permission.guard';
export {
  RequiredPermission,
  RequiredPlatformPermission,
  REQUIRED_PERMISSIONS_KEY,
  REQUIRED_PLATFORM_PERMISSIONS_KEY,
} from './decorators/required-permission.decorator';
export { BusinessId, BranchId } from './decorators/scope-id.decorator';
export {
  IS_SELF_SERVICE_KEY,
  SelfService,
} from './decorators/self-service.decorator';
export {
  Permission,
  PERMISSION_KEYS,
  isPermissionKey,
  type PermissionKey,
} from './permission.constant';
export {
  PlatformPermission,
  PLATFORM_ROLES,
  PLATFORM_ROLE_PERMISSIONS,
  type PlatformPermissionKey,
  type PlatformRole,
} from './platform-permission.constant';
export type { AuthorizedRequest } from './types';
