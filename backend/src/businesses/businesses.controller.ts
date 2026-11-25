import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AuditContext, type AuditRequestContext } from '../audit-logs';
import { RequiredRoles } from '../authentication/decorators/required_permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types';
import { BusinessesService } from './businesses.service';
import { UpdateBusinessHeaders } from './decorators/update-business-headers.decorator';
import { BusinessIdParamDto, UpdateBusinessHeadersDto } from './dto';
import type { UpdateBusinessDto } from './dto';
import { UpdateBusinessValidationPipe } from './pipes/update-business-validation.pipe';
import type { BusinessUpdateFiles } from './types';
import { requireBusinessOwner } from './utils/business-access.util';

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** Business profile routes for the owner. */
@Controller('businesses')
export class BusinessesController {
  constructor(private readonly businesses: BusinessesService) {}

  @Get(':businessId')
  @RequiredRoles('business.read')
  getBusiness(
    @Param() params: BusinessIdParamDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    const owner = requireBusinessOwner(user, params.businessId);
    return this.businesses.getBusinessProfile(params.businessId, owner);
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
        limits: { fileSize: MAX_DOCUMENT_BYTES, files: 3 },
      },
    ),
  )
  updateBusiness(
    @Param() params: BusinessIdParamDto,
    @Body(new UpdateBusinessValidationPipe()) dto: object,
    @UpdateBusinessHeaders() headers: UpdateBusinessHeadersDto,
    @UploadedFiles() files: BusinessUpdateFiles | undefined,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @AuditContext() auditContext: AuditRequestContext,
  ) {
    const owner = requireBusinessOwner(user, params.businessId);
    return this.businesses.updateBusinessProfile(
      params.businessId,
      owner,
      dto as UpdateBusinessDto,
      files,
      headers.idempotencyKey,
      auditContext,
    );
  }
}
