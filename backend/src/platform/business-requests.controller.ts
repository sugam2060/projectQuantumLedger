import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '../common/decorators/strict-throttle.decorator';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AuditContext, type AuditRequestContext } from '../audit-logs';
import { Public } from '../common/decorators/public.decorator';
import { BusinessRequestsService } from './business-requests.service';
import { BusinessUploadHeaders } from './decorators/business-upload-headers.decorator';
import { BusinessRequestDto } from './dto/business-request.dto';
import { BusinessUploadHeaderDto } from './dto/business-upload-header.dto';
import type { BusinessRequestFiles } from './types';

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** Public business enquiry form (website only). */
@Controller('platform/businesses')
export class BusinessRequestsController {
  constructor(private readonly businessRequests: BusinessRequestsService) {}

  @Post('request')
  @HttpCode(HttpStatus.CREATED)
  @Public()
  @Throttle({ limit: 5, ttlMs: 60 * 60_000 })
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
  async submitRequest(
    @BusinessUploadHeaders() _headers: BusinessUploadHeaderDto,
    @Body() request: BusinessRequestDto,
    @UploadedFiles() files: BusinessRequestFiles | undefined,
    @AuditContext() auditContext: AuditRequestContext,
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

    await this.businessRequests.submitBusinessRequest(
      request,
      {
        panCardFront: files.panCardFront[0],
        panCardBack: files.panCardBack[0],
        businessRegistrationCertificate:
          files.businessRegistrationCertificate[0],
      },
      auditContext,
    );
    return {
      message:
        'Your request has been submitted. Our team will contact you for further process.',
    };
  }
}
