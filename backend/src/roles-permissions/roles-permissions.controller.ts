import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../authentication/strategies/jwt.strategy';
import { EndpointAccessService } from './endpoint-access.service';
import { EndpointAccessCatalogService } from './endpoint-access-catalog.service';
import { EndpointKeyParamsDto } from './dto/endpoint-key-params.dto';
import { SetEndpointRolesDto } from './dto/set-endpoint-roles.dto';
import { Public } from '../authentication/decorators/public.decorator';

interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

@Controller('business/endpoint-access')
export class RolesPermissionsController {
  constructor(
    private readonly endpointAccess: EndpointAccessService,
    private readonly catalog: EndpointAccessCatalogService,
  ) {}

  @Public()
  @Get('endpoints')
  listConfigurableEndpoints() {
    return this.catalog.list();
  }

  @Get('')
  listEndpointRoles(@Req() request: AuthenticatedRequest) {
    return this.endpointAccess.listConfigurations(request.user);
  }

  @Put(':endpointKey')
  @HttpCode(HttpStatus.OK)
  setEndpointRoles(
    @Req() request: AuthenticatedRequest,
    @Param() params: EndpointKeyParamsDto,
    @Body() dto: SetEndpointRolesDto,
  ) {
    if (!this.catalog.has(params.endpointKey)) {
      throw new BadRequestException(
        'Endpoint key is not registered for role configuration',
      );
    }

    return this.endpointAccess.setRequiredRoles(
      request.user,
      params.endpointKey,
      dto.roleIds,
    );
  }

  @Delete(':endpointKey')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearEndpointRoles(
    @Req() request: AuthenticatedRequest,
    @Param() params: EndpointKeyParamsDto,
  ): Promise<void> {
    await this.endpointAccess.clearRequiredRoles(
      request.user,
      params.endpointKey,
    );
  }
}
