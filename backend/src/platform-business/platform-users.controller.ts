import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { RateLimit } from '../authentication/decorators/rate-limit.decorator';
import type { AuthenticatedUser } from '../authentication/strategies/jwt.strategy';
import { InvitePlatformUserHeaders } from './decorators/invite-platform-user-headers.decorator';
import { InvitePlatformUserDto } from './dto/invite-platform-user.dto';
import { InvitePlatformUserHeadersDto } from './dto/invite-platform-user-headers.dto';
import { PlatformUserInvitationsService } from './platform-user-invitations.service';

interface PlatformAuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

@Controller('platform/users')
export class PlatformUsersController {
  constructor(private readonly invitations: PlatformUserInvitationsService) {}

  @Post('invite')
  @HttpCode(HttpStatus.OK)
  @RateLimit({
    requests: 20,
    windowMs: 60 * 60_000,
    errorMessage: 'Too many platform invitations. Try again later.',
  })
  async invite(
    @Body() body: InvitePlatformUserDto,
    @InvitePlatformUserHeaders() headers: InvitePlatformUserHeadersDto,
    @Req() request: PlatformAuthenticatedRequest,
  ): Promise<{ message: string }> {
    const user = request.user;
    const platformUserId = user?.isPlatform
      ? (user.platformUserId ?? user.subjectId ?? user.userId ?? user.sub)
      : undefined;
    if (!platformUserId) {
      throw new ForbiddenException('Platform user authentication required');
    }

    return this.invitations.invitePlatformUser(
      body,
      headers.idempotencyKey,
      platformUserId,
      user.name,
    );
  }
}
