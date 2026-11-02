import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../authenticated-user.interface';
import { REQUIRED_PERMISSIONS, REQUIRED_ROLES } from '../auth.constants';

interface AuthorizationRequest extends Request {
  user?: AuthenticatedUser;
}

@Injectable()
export class AccessControlGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles =
      this.reflector.getAllAndOverride<string[]>(REQUIRED_ROLES, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const permissions =
      this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    if (roles.length === 0 && permissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthorizationRequest>();
    const user = request.user;
    const businessId = readScope(
      readParameter(request.params.businessId),
      request.headers['x-business-id'],
    );
    const branchId = readScope(
      readParameter(request.params.branchId),
      request.headers['x-branch-id'],
    );

    if (!user || !businessId) {
      throw new ForbiddenException();
    }

    const membership = user.memberships.find(
      (candidate) => candidate.businessId === businessId,
    );
    if (!membership || (branchId && !membership.branchIds.includes(branchId))) {
      throw new ForbiddenException();
    }

    const branchGrant = branchId
      ? membership.branchAccess.find(
          (candidate) => candidate.branchId === branchId,
        )
      : undefined;
    const grantedRoles = new Set([
      ...membership.roles,
      ...(branchGrant?.roles ?? []),
    ]);
    const grantedPermissions = new Set([
      ...membership.permissions,
      ...(branchGrant?.permissions ?? []),
    ]);

    if (
      !roles.every((role) => grantedRoles.has(role)) ||
      !permissions.every((permission) => grantedPermissions.has(permission))
    ) {
      throw new ForbiddenException();
    }

    return true;
  }
}

function readScope(
  parameter: string | undefined,
  header: string | string[] | undefined,
): string | undefined {
  if (typeof parameter === 'string' && parameter.length > 0) {
    return parameter;
  }

  if (typeof header === 'string' && header.length > 0) {
    return header;
  }

  if (Array.isArray(header) && header.length > 0) {
    return header[0];
  }

  return undefined;
}

function readParameter(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  return value?.[0];
}
