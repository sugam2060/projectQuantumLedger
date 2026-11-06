import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const clientType = request.headers['x-client-type'];

    // For web clients, extract JWT from cookie
    if (clientType === 'web') {
      const token = request.cookies?.access_token;
      if (token) {
        // Add token to Authorization header for passport to process
        request.headers.authorization = `Bearer ${token}`;
      }
    }

    return super.canActivate(context);
  }
}
