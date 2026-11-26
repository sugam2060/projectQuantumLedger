import { Controller, Get, Query } from '@nestjs/common';
import {
  BranchId,
  BusinessId,
  Permission,
  RequiredPermission,
} from '../authorization';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types';
import { BranchesService } from './branches.service';
import { ListBranchesQueryDto } from './dto';

/** Branch reads for members of the business. */
@Controller('businesses')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get(':businessId/branches')
  @RequiredPermission(Permission.BRANCH_READ)
  listBranches(
    @BusinessId() businessId: string,
    @Query() query: ListBranchesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.branches.listBranches(businessId, user, query);
  }

  @Get(':businessId/branches/:branchId')
  @RequiredPermission(Permission.BRANCH_READ)
  getBranch(
    @BusinessId() businessId: string,
    @BranchId() branchId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.branches.getBranchDetails(businessId, branchId, user);
  }
}
