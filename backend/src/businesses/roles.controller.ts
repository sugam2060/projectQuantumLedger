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
} from '@nestjs/common';
import { BusinessId, Permission, RequiredPermission } from '../authorization';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types';
import { CreateRoleDto, UpdateRoleDto } from './dto';
import { RolesService } from './roles.service';

/** The permission catalogue and a business's roles. */
@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  /** Every permission code with its description (for role editors). */
  @Get('permissions')
  listPermissions(@CurrentUser() user: AuthenticatedUser) {
    return this.roles.listPermissions(user.userId as string);
  }

  @Get('businesses/:businessId/roles')
  @RequiredPermission(Permission.ROLE_READ)
  listRoles(
    @BusinessId() businessId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roles.listRoles(user.userId as string, businessId);
  }

  @Get('businesses/:businessId/roles/:roleId')
  @RequiredPermission(Permission.ROLE_READ)
  getRole(
    @BusinessId() businessId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roles.getRole(user.userId as string, businessId, roleId);
  }

  @Post('businesses/:businessId/roles')
  @RequiredPermission(Permission.ROLE_CREATE)
  createRole(
    @BusinessId() businessId: string,
    @Body() dto: CreateRoleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roles.createRole(user.userId as string, businessId, dto);
  }

  @Patch('businesses/:businessId/roles/:roleId')
  @RequiredPermission(Permission.ROLE_UPDATE)
  updateRole(
    @BusinessId() businessId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roles.updateRole(
      user.userId as string,
      businessId,
      roleId,
      dto,
    );
  }

  @Delete('businesses/:businessId/roles/:roleId')
  @RequiredPermission(Permission.ROLE_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRole(
    @BusinessId() businessId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.roles.deleteRole(user.userId as string, businessId, roleId);
  }
}
