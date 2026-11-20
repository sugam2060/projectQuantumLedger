import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  Req,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request } from 'express';
import {
  RequireConfiguredRoles,
  RequiredRoles,
} from '../authentication/decorators/required_permission.decorator';
import type { AuthenticatedUser } from '../authentication/strategies/jwt.strategy';
import {
  BusinessBranchParamDto,
  BusinessIdParamDto,
} from './dto/business-id-param.dto';
import { UpdateBusinessHeaders } from './decorators/update-business-headers.decorator';
import { UpdateBusinessHeadersDto } from './dto/update-business-headers.dto';
import type { UpdateBusinessDto } from './dto/update-business.dto';
import { BusinessService } from './business.service';
import type { BusinessUpdateFiles } from './business.utils.service';
import { UpdateBusinessValidationPipe } from './pipes/update-business-validation.pipe';
import { ListBranchesQueryDto } from './dto/list-branches-query.dto';

interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

@Controller('businesses')
export class BusinessController {
  constructor(private readonly businessService: BusinessService) {}

  @Get(':businessId')
  @RequiredRoles('business.read')
  getBusiness(
    @Param() params: BusinessIdParamDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const user = request.user;
    if (
      user?.isOwner !== true ||
      user.isPlatform === true ||
      user.businessId !== params.businessId
    ) {
      throw new ForbiddenException('Business owner access required');
    }
    return this.businessService.getBusinessProfile(params.businessId);
  }

  @Get(':businessId/branches')
  @RequiredRoles('branches.read')
  @RequireConfiguredRoles()
  listBranches(
    @Param() params: BusinessIdParamDto,
    @Query() query: ListBranchesQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const user = request.user;
    if (
      user?.isPlatform === true ||
      !user?.businessId ||
      user.businessId !== params.businessId
    ) {
      throw new ForbiddenException('Business branch access required');
    }
    return this.businessService.listBranches(params.businessId, user, query);
  }

  @Get(':businessId/branches/:branchId')
  @RequiredRoles('branches.read')
  @RequireConfiguredRoles()
  getBranch(
    @Param() params: BusinessBranchParamDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const user = request.user;
    if (
      user?.isPlatform === true ||
      !user?.businessId ||
      user.businessId !== params.businessId
    ) {
      throw new ForbiddenException('Business branch access required');
    }
    return this.businessService.getBranchDetails(
      params.businessId,
      params.branchId,
      user,
    );
  }

  @Patch(':businessId')
  @RequiredRoles('business.update')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'panCardFront', maxCount: 1 },
        { name: 'panCardBack', maxCount: 1 },
        { name: 'businessRegistrationCertificate', maxCount: 1 },
      ],
      {
        storage: memoryStorage(),
        limits: { fileSize: 10 * 1024 * 1024, files: 3 },
      },
    ),
  )
  updateBusiness(
    @Param() params: BusinessIdParamDto,
    @Body(new UpdateBusinessValidationPipe()) dto: object,
    @UpdateBusinessHeaders() headers: UpdateBusinessHeadersDto,
    @UploadedFiles() files: BusinessUpdateFiles | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const user = request.user;
    if (
      user?.isOwner !== true ||
      user.isPlatform === true ||
      user.businessId !== params.businessId
    ) {
      throw new ForbiddenException('Business owner access required');
    }
    return this.businessService.updateBusinessProfile(
      params.businessId,
      user,
      dto as UpdateBusinessDto,
      files,
      headers.idempotencyKey,
      {
        method: request.method,
        endpointPath: request.route?.path,
        requestId: request.header('x-request-id'),
        clientType: request.header('x-client-type'),
        ipAddress: request.ip,
        userAgent: request.header('user-agent'),
      },
    );
  }
}
