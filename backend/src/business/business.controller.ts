import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { RequiredRoles } from '../authentication/decorators/required_permission.decorator';
import type { AuthenticatedUser } from '../authentication/strategies/jwt.strategy';
import { BusinessIdParamDto } from './dto/business-id-param.dto';
import { BusinessService } from './business.service';

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
}
