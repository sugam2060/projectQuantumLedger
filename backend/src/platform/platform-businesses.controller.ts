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
import { AuditContext, type AuditRequestContext } from '../audit-logs';
import { RateLimit } from '../authentication/decorators/rate-limit.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
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
export class PlatformBusinessesController {
  constructor(private readonly platformBusinesses: PlatformBusinessesService) {}

  @Get('business/:business_id')
  @HttpCode(HttpStatus.OK)
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
  @RateLimit({
    requests: 20,
    windowMs: 60 * 60_000,
    errorMessage: 'Too many provisioning requests. Try again later.',
  })
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
