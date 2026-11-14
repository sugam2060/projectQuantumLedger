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
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Public } from '../authentication/decorators/public.decorator';
import { RateLimit } from '../authentication/decorators/rate-limit.decorator';
import { BusinessUploadHeaders } from './decorators/business-upload-headers.decorator';
import { BusinessUploadHeaderDto } from './dto/business-upload-header.dto';
import { BusinessRequestDto } from './dto/business-request.dto';
import { PlatformBusinessService } from './platform-business.service';

export interface BusinessRequestFiles {
  panCardFront?: Express.Multer.File[];
  panCardBack?: Express.Multer.File[];
  businessRegistrationCertificate?: Express.Multer.File[];
}

@Controller('platform/businesses')
export class PlatformBusinessController {
  constructor(private readonly platformBusiness: PlatformBusinessService) {}

  @Post('request')
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

    await this.platformBusiness.submitBusinessRequest(request, {
      panCardFront: files.panCardFront[0],
      panCardBack: files.panCardBack[0],
      businessRegistrationCertificate: files.businessRegistrationCertificate[0],
    });
    return {
      message:
        'Your request has been submitted. Our team will contact you for further process.',
    };
  }
}
