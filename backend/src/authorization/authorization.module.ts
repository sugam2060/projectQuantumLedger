import { Module } from '@nestjs/common';
import { AuthorizationRepository } from './authorization.repository';
import { PermissionGuard } from './guards/permission.guard';
import { PermissionService } from './permission.service';

/** Permission checks for business users and platform staff. */
@Module({
  providers: [AuthorizationRepository, PermissionService, PermissionGuard],
  exports: [PermissionService, PermissionGuard],
})
export class AuthorizationModule {}
