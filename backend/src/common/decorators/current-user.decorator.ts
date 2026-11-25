import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from '../types';

/**
 * Injects the authenticated caller (`request.user`). On `@Public()` routes it is
 * `undefined`, so only use it on routes the global JWT guard protects.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser | undefined =>
    context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user,
);
