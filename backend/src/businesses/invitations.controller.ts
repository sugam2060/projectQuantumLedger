import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  BranchId,
  BusinessId,
  Permission,
  RequiredPermission,
} from '../authorization';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Throttle } from '../common/decorators/strict-throttle.decorator';
import type { AuthenticatedUser } from '../common/types';
import { CreateInvitationsDto } from './dto';
import { InvitationsService } from './invitations.service';

const inviter = (user: AuthenticatedUser) => ({
  userId: user.userId as string,
  name: user.name,
});

/**
 * Business-side invitations. Each route also exists under
 * `/branches/:branchId/...` for branch managers (invitations into that branch).
 */
@Controller('businesses')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  /** Up to 20 addresses; answers 200 with one status per address. */
  @Post([
    ':businessId/invitations',
    ':businessId/branches/:branchId/invitations',
  ])
  @RequiredPermission(Permission.MEMBER_INVITE)
  @HttpCode(HttpStatus.OK)
  @Throttle({ limit: 30, ttlMs: 60 * 60_000 })
  invite(
    @BusinessId() businessId: string,
    @BranchId() branchId: string | undefined,
    @Body() dto: CreateInvitationsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invitations.invite(inviter(user), businessId, dto, branchId);
  }

  @Get([
    ':businessId/invitations',
    ':businessId/branches/:branchId/invitations',
  ])
  @RequiredPermission(Permission.MEMBER_READ)
  list(
    @BusinessId() businessId: string,
    @BranchId() branchId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invitations.list(user.userId as string, businessId, branchId);
  }

  @Post([
    ':businessId/invitations/:invitationId/resend',
    ':businessId/branches/:branchId/invitations/:invitationId/resend',
  ])
  @RequiredPermission(Permission.MEMBER_INVITE)
  @HttpCode(HttpStatus.OK)
  @Throttle({ limit: 30, ttlMs: 60 * 60_000 })
  resend(
    @BusinessId() businessId: string,
    @BranchId() branchId: string | undefined,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invitations.resend(
      inviter(user),
      businessId,
      invitationId,
      branchId,
    );
  }

  @Delete([
    ':businessId/invitations/:invitationId',
    ':businessId/branches/:branchId/invitations/:invitationId',
  ])
  @RequiredPermission(Permission.MEMBER_INVITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @BusinessId() businessId: string,
    @BranchId() branchId: string | undefined,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.invitations.revoke(
      user.userId as string,
      businessId,
      invitationId,
      branchId,
    );
  }
}
