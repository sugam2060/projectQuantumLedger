import { AuditLogsModule } from '../audit-logs';
import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { RolesPermissionsController } from './roles-permissions.controller';
import { EndpointAccessService } from './endpoint-access.service';
import { EndpointAccessCatalogService } from './endpoint-access-catalog.service';
import { EffectivePermissionsCacheService } from './effective-permissions-cache.service';
import { EffectivePermissionsService } from './effective-permissions.service';

@Module({
  imports: [AuditLogsModule, DiscoveryModule],
  controllers: [RolesPermissionsController],
  providers: [
    EndpointAccessService,
    EndpointAccessCatalogService,
    EffectivePermissionsCacheService,
    EffectivePermissionsService,
  ],
  exports: [
    EndpointAccessService,
    EndpointAccessCatalogService,
    EffectivePermissionsCacheService,
    EffectivePermissionsService,
  ],
})
export class RolesPermissionsModule {}
