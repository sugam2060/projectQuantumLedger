import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AuditContext, type AuditRequestContext } from '../audit-logs';
import { BusinessId, Permission, RequiredPermission } from '../authorization';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types';
import { BusinessesService } from './businesses.service';
import { UpdateBusinessHeaders } from './decorators/update-business-headers.decorator';
import { UpdateBusinessHeadersDto } from './dto';
import type { UpdateBusinessDto } from './dto';
import { UpdateBusinessValidationPipe } from './pipes/update-business-validation.pipe';
import type { BusinessUpdateFiles } from './types';

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** Business profile routes (permission-checked). */
@Controller('businesses')
export class BusinessesController {
  constructor(private readonly businesses: BusinessesService) {}

  @Get(':businessId')
  @RequiredPermission(Permission.BUSINESS_READ)
  getBusiness(
    @BusinessId() businessId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.businesses.getBusinessProfile(businessId, user);
  }

  @Patch(':businessId')
  @RequiredPermission(Permission.BUSINESS_UPDATE)
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
    @BusinessId() businessId: string,
    @Body(new UpdateBusinessValidationPipe()) dto: object,
    @UpdateBusinessHeaders() headers: UpdateBusinessHeadersDto,
    @UploadedFiles() files: BusinessUpdateFiles | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @AuditContext() auditContext: AuditRequestContext,
  ) {
    return this.businesses.updateBusinessProfile(
      businessId,
      user,
      dto as UpdateBusinessDto,
      files,
      headers.idempotencyKey,
      auditContext,
    );
  }
}
