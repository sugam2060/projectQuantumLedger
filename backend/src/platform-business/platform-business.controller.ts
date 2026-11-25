import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Public } from '../common/decorators/public.decorator';
import { RateLimit } from '../authentication/decorators/rate-limit.decorator';
import { BusinessUploadHeaders } from './decorators/business-upload-headers.decorator';
import { BusinessUploadHeaderDto } from './dto/business-upload-header.dto';
import { BusinessRequestDto } from './dto/business-request.dto';
import { PlatformBusinessService } from './platform-business.service';
import { ProvisionBusinessDto } from './dto/provision-business.dto';
import { ProvisionBusinessHeadersDto } from './dto/provision-business-headers.dto';
import { ProvisionBusinessQueryDto } from './dto/provision-business-query.dto';
import { ProvisionBusinessHeaders } from './decorators/provision-business-headers.decorator';
import { BusinessListHeaders } from './decorators/business-list-headers.decorator';
import { BusinessListHeadersDto } from './dto/business-list-headers.dto';
import { ListBusinessesQueryDto } from './dto/list-businesses-query.dto';
import { BusinessBranchParamsDto } from './dto/business-branch-params.dto';
import { CreateBusinessBranchDto } from './dto/create-business-branch.dto';
import type { AuthenticatedUser } from '../authentication/strategies/jwt.strategy';
import type { Request } from 'express';

interface PlatformAuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

export interface BusinessRequestFiles {
  panCardFront?: Express.Multer.File[];
  panCardBack?: Express.Multer.File[];
  businessRegistrationCertificate?: Express.Multer.File[];
}

@Controller('platform')
export class PlatformBusinessController {
  constructor(private readonly platformBusiness: PlatformBusinessService) {}

  @Get('business/:business_id')
  @HttpCode(HttpStatus.OK)
  async getBusiness(
    @Param('business_id', new ParseUUIDPipe()) businessId: string,
    @Req() request: PlatformAuthenticatedRequest,
  ) {
    const clientType = request.header('x-client-type');
    if (
      typeof clientType !== 'string' ||
      !['web', 'mobile', 'desktop'].includes(clientType)
    ) {
      throw new BadRequestException('A valid x-client-type header is required');
    }

    const isPlatformUser = request.user?.isPlatform === true;
    const platformUserId = isPlatformUser
      ? (request.user.platformUserId ??
        request.user.subjectId ??
        request.user.userId ??
        request.user.sub)
      : undefined;
    if (!platformUserId) {
      throw new ForbiddenException('Platform user authentication required');
    }

    return this.platformBusiness.getBusinessDetails(businessId, platformUserId);
  }

  @Get()
  async listBusinesses(
    @Query() query: ListBusinessesQueryDto,
    @BusinessListHeaders() _headers: BusinessListHeadersDto,
    @Req() request: PlatformAuthenticatedRequest,
  ) {
    const user = request.user;
    const platformUserId = user?.isPlatform
      ? (user.platformUserId ?? user.subjectId ?? user.userId ?? user.sub)
      : undefined;
    if (!platformUserId) {
      throw new ForbiddenException('Platform user authentication required');
    }

    return this.platformBusiness.listBusinesses(
      { page: query.page, limit: query.limit },
      platformUserId,
    );
  }

  @Get('business/:business_id/:branch_id')
  @HttpCode(HttpStatus.OK)
  async getBranch(
    @Param('business_id', new ParseUUIDPipe()) businessId: string,
    @Param('branch_id', new ParseUUIDPipe()) branchId: string,
    @Req() request: PlatformAuthenticatedRequest,
  ) {
    const clientType = request.header('x-client-type');
    if (
      typeof clientType !== 'string' ||
      !['web', 'mobile', 'desktop'].includes(clientType)
    ) {
      throw new BadRequestException('A valid x-client-type header is required');
    }

    const isPlatformUser = request.user?.isPlatform === true;
    const platformUserId = isPlatformUser
      ? (request.user.platformUserId ??
        request.user.subjectId ??
        request.user.userId ??
        request.user.sub)
      : undefined;
    if (!platformUserId) {
      throw new ForbiddenException('Platform user authentication required');
    }

    return this.platformBusiness.getBranchDetails(
      businessId,
      branchId,
      platformUserId,
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
    @Req() request: PlatformAuthenticatedRequest,
  ) {
    const isPlatformUser = request.user?.isPlatform === true;
    const platformUserId = isPlatformUser
      ? (request.user.platformUserId ??
        request.user.subjectId ??
        request.user.userId ??
        request.user.sub)
      : undefined;
    if (!platformUserId) {
      throw new ForbiddenException('Platform user authentication required');
    }
    return this.platformBusiness.provisionBusiness(
      query.requested_business_id,
      body,
      headers.idempotencyKey,
      platformUserId,
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

  @Post('businesses/:businessId/branches')
  @HttpCode(HttpStatus.CREATED)
  async createBranch(
    @Param() params: BusinessBranchParamsDto,
    @Body() body: CreateBusinessBranchDto,
    @ProvisionBusinessHeaders() headers: ProvisionBusinessHeadersDto,
    @Req() request: PlatformAuthenticatedRequest,
  ) {
    const isPlatformUser = request.user?.isPlatform === true;
    const platformUserId = isPlatformUser
      ? (request.user.platformUserId ??
        request.user.subjectId ??
        request.user.userId ??
        request.user.sub)
      : undefined;
    if (!platformUserId) {
      throw new ForbiddenException('Platform user authentication required');
    }

    return this.platformBusiness.createBranch(
      params.businessId,
      body,
      headers.idempotencyKey,
      platformUserId,
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

  @Post('businesses/request')
  @HttpCode(HttpStatus.CREATED)
  @Public()
  @RateLimit({
    requests: 5,
    windowMs: 60 * 60_000,
    errorMessage: 'Too many business requests. Try again later.',
  })
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
  async submitRequest(
    @BusinessUploadHeaders() _headers: BusinessUploadHeaderDto,
    @Body() request: BusinessRequestDto,
    @UploadedFiles() files: BusinessRequestFiles | undefined,
    @Req() req: Request,
  ) {
    if (
      !files?.panCardFront?.[0] ||
      !files.panCardBack?.[0] ||
      !files.businessRegistrationCertificate?.[0]
    ) {
      throw new BadRequestException(
        'PAN front, PAN back, and business registration files are required',
      );
    }

    await this.platformBusiness.submitBusinessRequest(
      request,
      {
        panCardFront: files.panCardFront[0],
        panCardBack: files.panCardBack[0],
        businessRegistrationCertificate:
          files.businessRegistrationCertificate[0],
      },
      {
        method: req.method,
        endpointPath: req.route?.path,
        requestId: req.header('x-request-id'),
        clientType: req.header('x-client-type'),
        ipAddress: req.ip,
        userAgent: req.header('user-agent'),
      },
    );
    return {
      message:
        'Your request has been submitted. Our team will contact you for further process.',
    };
  }
}
