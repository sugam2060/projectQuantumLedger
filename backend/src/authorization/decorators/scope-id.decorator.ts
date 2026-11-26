import {
  createParamDecorator,
  type ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import type { AuthorizedRequest } from '../types';

/**
 * The business id PermissionGuard validated and authorized. Use only on routes
 * with `@RequiredPermission`; anywhere else it is a programming error (500).
 */
export const BusinessId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const id = context
      .switchToHttp()
      .getRequest<AuthorizedRequest>().authorizedBusinessId;
    if (!id) {
      throw new InternalServerErrorException(
        '@BusinessId() used on a route without @RequiredPermission',
      );
    }
    return id;
  },
);

/** The branch id PermissionGuard validated (undefined when the route has none). */
export const BranchId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | undefined =>
    context.switchToHttp().getRequest<AuthorizedRequest>().authorizedBranchId,
);
