import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { Reflector } from '@nestjs/core';
import { REQUIRED_PERMISSION } from '../decorators/required_permission.decorator';
import { PermissionName } from '../../database/permission.constant';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // get required permissions from decorator metadata
    const requiredPermissions: PermissionName[] =
      this.reflector.getAllAndOverride<PermissionName[]>(REQUIRED_PERMISSION, [
        context.getHandler(),
        context.getClass(),
      ]);

    // No required permissions means access is allowed
    if (!requiredPermissions || requiredPermissions.length === 0) return true;

    // Get Authenticated user
    const request = context.switchToHttp().getRequest();

    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    const userPermissions: PermissionName[] = user.permissions ?? [];

    const hasPermission = requiredPermissions.every((permission) =>
      userPermissions.includes(permission),
    );

    if (!hasPermission) {
      throw new ForbiddenException('User does not have sufficient permissions');
    }

    return true;
  }
}
