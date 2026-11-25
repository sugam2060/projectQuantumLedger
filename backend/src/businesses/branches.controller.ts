import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  RequireConfiguredRoles,
  RequiredRoles,
} from '../authentication/decorators/required_permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types';
import { BranchesService } from './branches.service';
import {
  BusinessBranchParamDto,
  BusinessIdParamDto,
  ListBranchesQueryDto,
} from './dto';
import { requireBusinessMember } from './utils/business-access.util';

/** Branch reads for members of the business. */
@Controller('businesses')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get(':businessId/branches')
  @RequiredRoles('branches.read')
  @RequireConfiguredRoles()
  listBranches(
    @Param() params: BusinessIdParamDto,
    @Query() query: ListBranchesQueryDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    const member = requireBusinessMember(user, params.businessId);
    return this.branches.listBranches(params.businessId, member, query);
  }

  @Get(':businessId/branches/:branchId')
  @RequiredRoles('branches.read')
  @RequireConfiguredRoles()
  getBranch(
    @Param() params: BusinessBranchParamDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    const member = requireBusinessMember(user, params.businessId);
    return this.branches.getBranchDetails(
      params.businessId,
      params.branchId,
      member,
    );
  }
}
