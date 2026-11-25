import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '../common/decorators/strict-throttle.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PlatformRoute } from '../common/decorators/platform-route.decorator';
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
}
