import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '../common/decorators/strict-throttle.decorator';
import { AuditContext, type AuditRequestContext } from '../audit-logs';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PlatformRoute } from '../common/decorators/platform-route.decorator';
import {
  PlatformPermission,
  RequiredPlatformPermission,
} from '../authorization';
import type { AuthenticatedUser } from '../common/types';
import { BusinessListHeaders } from './decorators/business-list-headers.decorator';
import { ProvisionBusinessHeaders } from './decorators/provision-business-headers.decorator';
import { BusinessBranchParamsDto } from './dto/business-branch-params.dto';
import { BusinessListHeadersDto } from './dto/business-list-headers.dto';
import { CreateBusinessBranchDto } from './dto/create-business-branch.dto';
import { ListBusinessesQueryDto } from './dto/list-businesses-query.dto';
import { ProvisionBusinessDto } from './dto/provision-business.dto';
import { ProvisionBusinessHeadersDto } from './dto/provision-business-headers.dto';
import { ProvisionBusinessQueryDto } from './dto/provision-business-query.dto';
import { PlatformBusinessesService } from './platform-businesses.service';
import { requirePlatformUserId } from './utils/platform-user-id.util';

const READ_CLIENT_TYPES = ['web', 'mobile', 'desktop'];

/** Fortis-staff routes for reading, listing and provisioning businesses. */
@Controller('platform')
@PlatformRoute()
export class PlatformBusinessesController {
  constructor(private readonly platformBusinesses: PlatformBusinessesService) {}

  @Get('business/:business_id')
  @HttpCode(HttpStatus.OK)
  @RequiredPlatformPermission(PlatformPermission.BUSINESS_READ)
  async getBusiness(
    @Param('business_id', new ParseUUIDPipe()) businessId: string,
    @Headers('x-client-type') clientType: string | undefined,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    assertReadClientType(clientType);
    return this.platformBusinesses.getBusinessDetails(
      businessId,
      requirePlatformUserId(user),
    );
  }

  @Get()
  @RequiredPlatformPermission(PlatformPermission.BUSINESS_READ)
  async listBusinesses(
    @Query() query: ListBusinessesQueryDto,
    @BusinessListHeaders() _headers: BusinessListHeadersDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.platformBusinesses.listBusinesses(
      { page: query.page, limit: query.limit },
      requirePlatformUserId(user),
    );
  }

  @Get('business/:business_id/:branch_id')
  @HttpCode(HttpStatus.OK)
  @RequiredPlatformPermission(PlatformPermission.BUSINESS_READ)
  async getBranch(
    @Param('business_id', new ParseUUIDPipe()) businessId: string,
    @Param('branch_id', new ParseUUIDPipe()) branchId: string,
    @Headers('x-client-type') clientType: string | undefined,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    assertReadClientType(clientType);
    return this.platformBusinesses.getBranchDetails(
      businessId,
      branchId,
      requirePlatformUserId(user),
    );
  }

  @Post('businesses/create')
  @HttpCode(HttpStatus.CREATED)
  @RequiredPlatformPermission(PlatformPermission.BUSINESS_PROVISION)
  @Throttle({ limit: 20, ttlMs: 60 * 60_000 })
  async provisionBusiness(
    @Query() query: ProvisionBusinessQueryDto,
    @Body() body: ProvisionBusinessDto,
    @ProvisionBusinessHeaders() headers: ProvisionBusinessHeadersDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @AuditContext() auditContext: AuditRequestContext,
  ) {
    return this.platformBusinesses.provisionBusiness(
      query.requested_business_id,
      body,
      headers.idempotencyKey,
      requirePlatformUserId(user),
      auditContext,
    );
  }

  @Post('businesses/:businessId/branches')
  @HttpCode(HttpStatus.CREATED)
  @RequiredPlatformPermission(PlatformPermission.BRANCH_CREATE)
  async createBranch(
    @Param() params: BusinessBranchParamsDto,
    @Body() body: CreateBusinessBranchDto,
    @ProvisionBusinessHeaders() headers: ProvisionBusinessHeadersDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @AuditContext() auditContext: AuditRequestContext,
  ) {
    return this.platformBusinesses.createBranch(
      params.businessId,
      body,
      headers.idempotencyKey,
      requirePlatformUserId(user),
      auditContext,
    );
  }
}

function assertReadClientType(clientType: string | undefined): void {
  if (
    typeof clientType !== 'string' ||
    !READ_CLIENT_TYPES.includes(clientType)
  ) {
    throw new BadRequestException('A valid x-client-type header is required');
  }
}
