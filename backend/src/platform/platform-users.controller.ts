import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { RateLimit } from '../authentication/decorators/rate-limit.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types';
import { InvitePlatformUserHeaders } from './decorators/invite-platform-user-headers.decorator';
import { InvitePlatformUserDto } from './dto/invite-platform-user.dto';
import { InvitePlatformUserHeadersDto } from './dto/invite-platform-user-headers.dto';
import { PlatformUsersService } from './platform-users.service';
import { requirePlatformUserId } from './utils/platform-user-id.util';

/** Fortis-staff management of other platform users. */
@Controller('platform/users')
export class PlatformUsersController {
  constructor(private readonly platformUsers: PlatformUsersService) {}

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
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<{ message: string }> {
    const platformUserId = requirePlatformUserId(user);
    return this.platformUsers.invitePlatformUser(
      body,
      headers.idempotencyKey,
      platformUserId,
      user?.name,
    );
  }
}
