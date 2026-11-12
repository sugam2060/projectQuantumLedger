import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { RolesPermissionsController } from './roles-permissions.controller';
import { EndpointAccessService } from './endpoint-access.service';
import { EndpointAccessCatalogService } from './endpoint-access-catalog.service';

@Module({
  imports: [DiscoveryModule],
  controllers: [RolesPermissionsController],
  providers: [EndpointAccessService, EndpointAccessCatalogService],
  exports: [EndpointAccessService, EndpointAccessCatalogService],
})
export class RolesPermissionsModule {}
