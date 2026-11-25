import { Module } from '@nestjs/common';
import { AuditLogsRepository } from './audit-logs.repository';
import { AuditLogsService } from './audit-logs.service';

/** Security/access audit trail shared by authentication, businesses and platform. */
@Module({
  providers: [AuditLogsRepository, AuditLogsService],
  exports: [AuditLogsService],
})
export class AuditLogsModule {}
