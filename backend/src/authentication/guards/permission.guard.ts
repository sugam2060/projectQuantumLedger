import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EndpointAccessService } from '../../roles-permissions/endpoint-access.service';
import { IS_PUBLIC } from '../decorators/public.decorator';
import { REQUIRED_ROLES } from '../decorators/required_permission.decorator';
import { AuthenticatedUser } from '../strategies/jwt.strategy';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly endpointAccess: EndpointAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
    }>();
    if (request.user?.isPlatform === true) return true;

    const endpointKey = this.reflector.getAllAndOverride<string>(
      REQUIRED_ROLES,
      [context.getHandler(), context.getClass()],
    );

    if (!endpointKey) return true;

    if (!request.user) {
      throw new ForbiddenException('User not authenticated');
    }

    const allowed = await this.endpointAccess.hasAccess(
      request.user,
      endpointKey,
    );
    if (!allowed) {
      throw new ForbiddenException('User does not have an allowed role');
    }

    return true;
  }
}
