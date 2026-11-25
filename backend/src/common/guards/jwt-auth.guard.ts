import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PLATFORM_ROUTE_KEY } from '../decorators/platform-route.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/** Passport strategy names (registered in AuthenticationModule). */
export const USER_JWT_STRATEGY = 'jwt';
export const PLATFORM_JWT_STRATEGY = 'platform-jwt';

class UserJwtGuard extends AuthGuard(USER_JWT_STRATEGY) {}
class PlatformJwtGuard extends AuthGuard(PLATFORM_JWT_STRATEGY) {}

/**
 * Global authentication guard. Skips `@Public()` routes. On `@PlatformRoute()`
 * routes it accepts only platform tokens; everywhere else only business-user
 * tokens. The two token kinds have different audiences, so one can never be
 * used in place of the other. The access token is read from the Authorization
 * header only (never from a cookie).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly userGuard = new UserJwtGuard();
  private readonly platformGuard = new PlatformJwtGuard();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }
    const isPlatformRoute = this.reflector.getAllAndOverride<boolean>(
      IS_PLATFORM_ROUTE_KEY,
      targets,
    );
    return isPlatformRoute
      ? this.platformGuard.canActivate(context)
      : this.userGuard.canActivate(context);
  }
}
