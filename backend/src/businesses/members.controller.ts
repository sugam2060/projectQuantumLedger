import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  BranchId,
  BusinessId,
  Permission,
  RequiredPermission,
} from '../authorization';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types';
import { SetOverrideDto, UpdateMemberDto } from './dto';
import { MembersService } from './members.service';

/**
 * Members of a business. Each route also exists under
 * `/branches/:branchId/...`: the permission is then checked at that branch and
 * only that branch's members are visible (how branch managers manage staff).
 */
@Controller('businesses')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get([':businessId/members', ':businessId/branches/:branchId/members'])
  @RequiredPermission(Permission.MEMBER_READ)
  list(
    @BusinessId() businessId: string,
    @BranchId() branchId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.members.list(user.userId as string, businessId, branchId);
  }

  @Get([
    ':businessId/members/:userId',
    ':businessId/branches/:branchId/members/:userId',
  ])
  @RequiredPermission(Permission.MEMBER_READ)
  get(
    @BusinessId() businessId: string,
    @BranchId() branchId: string | undefined,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.members.get(
      user.userId as string,
      businessId,
      targetUserId,
      branchId,
    );
  }

  @Patch([
    ':businessId/members/:userId',
    ':businessId/branches/:branchId/members/:userId',
  ])
  @RequiredPermission(Permission.MEMBER_UPDATE)
  update(
    @BusinessId() businessId: string,
    @BranchId() branchId: string | undefined,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Body() dto: UpdateMemberDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.members.update(
      user.userId as string,
      businessId,
      targetUserId,
      dto,
      branchId,
    );
  }

  @Post([
    ':businessId/members/:userId/end-membership',
    ':businessId/branches/:branchId/members/:userId/end-membership',
  ])
  @RequiredPermission(Permission.MEMBER_END)
  @HttpCode(HttpStatus.NO_CONTENT)
  async end(
    @BusinessId() businessId: string,
    @BranchId() branchId: string | undefined,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.members.end(
      user.userId as string,
      businessId,
      targetUserId,
      branchId,
    );
  }

  @Put(':businessId/members/:userId/overrides/:permissionKey')
  @RequiredPermission(Permission.OVERRIDE_MANAGE)
  setOverride(
    @BusinessId() businessId: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Param('permissionKey') permissionKey: string,
    @Body() dto: SetOverrideDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.members.setOverride(
      user.userId as string,
      businessId,
      targetUserId,
      permissionKey,
      dto.effect,
    );
  }

  @Delete(':businessId/members/:userId/overrides/:permissionKey')
  @RequiredPermission(Permission.OVERRIDE_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearOverride(
    @BusinessId() businessId: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Param('permissionKey') permissionKey: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.members.clearOverride(
      user.userId as string,
      businessId,
      targetUserId,
      permissionKey,
    );
  }
}
