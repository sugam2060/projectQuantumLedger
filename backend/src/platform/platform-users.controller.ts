import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  StrictThrottle,
  Throttle,
} from '../common/decorators/strict-throttle.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AcceptPlatformInvitationDto } from './dto/accept-platform-invitation.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PlatformRoute } from '../common/decorators/platform-route.decorator';
import {
  PlatformPermission,
  RequiredPlatformPermission,
} from '../authorization';
import type { AuthenticatedUser } from '../common/types';
import { InvitePlatformUserHeaders } from './decorators/invite-platform-user-headers.decorator';
import { InvitePlatformUserDto } from './dto/invite-platform-user.dto';
import { InvitePlatformUserHeadersDto } from './dto/invite-platform-user-headers.dto';
import { PlatformUsersService } from './platform-users.service';
import { requirePlatformUserId } from './utils/platform-user-id.util';

/** Fortis-staff management of other platform users. */
@Controller('platform/users')
@PlatformRoute()
export class PlatformUsersController {
  constructor(private readonly platformUsers: PlatformUsersService) {}

  @Post('invite')
  @HttpCode(HttpStatus.OK)
  @RequiredPlatformPermission(PlatformPermission.PLATFORM_USER_INVITE)
  @Throttle({ limit: 20, ttlMs: 60 * 60_000 })
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

  /** Public: the invited staff member sets a password with the emailed token. */
  @Post('invitations/accept')
  @Public()
  @StrictThrottle()
  @HttpCode(HttpStatus.OK)
  acceptInvitation(@Body() body: AcceptPlatformInvitationDto) {
    return this.platformUsers.acceptInvitation(body.token, body.password);
  }
}
