import {
  BadRequestException,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import {
  REQUIRED_PERMISSIONS_KEY,
  REQUIRED_PLATFORM_PERMISSIONS_KEY,
} from '../decorators/required-permission.decorator';
import type { PermissionKey } from '../permission.constant';
import type { PlatformPermissionKey } from '../platform-permission.constant';
import { PermissionService } from '../permission.service';
import type { AuthorizedRequest } from '../types';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One message for every denial, so responses do not reveal why. */
export const PERMISSION_DENIED = 'You do not have permission for this action';

/**
 * Global guard, registered last (after authentication and throttling).
 *
 * - no `@RequiredPermission` / `@RequiredPlatformPermission`  -> pass
 * - no authenticated user                                      -> 401
 * - `:businessId` / `:branchId` not a UUID                     -> 400
 * - any denial (wrong token kind, no membership, missing
 *   permission, other branch, deny override)                   -> 403, same body
 *
 * On success the validated ids are stored on the request for `@BusinessId()`
 * and `@BranchId()`.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }
    const required = this.reflector.getAllAndOverride<
      PermissionKey[] | undefined
    >(REQUIRED_PERMISSIONS_KEY, targets);
    const requiredPlatform = this.reflector.getAllAndOverride<
      PlatformPermissionKey[] | undefined
    >(REQUIRED_PLATFORM_PERMISSIONS_KEY, targets);
    if (!required?.length && !requiredPlatform?.length) return true;

    const request = context.switchToHttp().getRequest<AuthorizedRequest>();
    const user = request.user;
    if (!user) throw new UnauthorizedException();

    if (requiredPlatform?.length) {
      if (
        user.isPlatform !== true ||
        !this.permissions.platformHasAll(user, requiredPlatform)
      ) {
        throw new ForbiddenException(PERMISSION_DENIED);
      }
      return true;
    }

    const params = (request.params ?? {}) as Record<string, string | undefined>;
    if (!('businessId' in params)) {
      // Caught by the route audit test; never reachable in a correct build.
      throw new InternalServerErrorException(
        '@RequiredPermission used on a route without :businessId',
      );
    }
    const businessId = uuidParam(params.businessId, 'businessId');
    const branchId =
      'branchId' in params ? uuidParam(params.branchId, 'branchId') : undefined;

    if (user.isPlatform === true || !user.userId) {
      throw new ForbiddenException(PERMISSION_DENIED);
    }
    const allowed = await this.permissions.hasAll(
      user.userId,
      businessId,
      branchId,
      required ?? [],
    );
    if (!allowed) throw new ForbiddenException(PERMISSION_DENIED);

    request.authorizedBusinessId = businessId;
    request.authorizedBranchId = branchId;
    return true;
  }
}

function uuidParam(value: string | undefined, name: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new BadRequestException(`${name} must be a UUID`);
  }
  return value.toLowerCase();
}
