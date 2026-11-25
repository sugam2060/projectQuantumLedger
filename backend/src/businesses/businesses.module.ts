import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs';
import { StorageModule } from '../storage';
import { BranchesController } from './branches.controller';
import { BranchesRepository } from './branches.repository';
import { BranchesService } from './branches.service';
import { BusinessUpdateIdempotencyService } from './business-update-idempotency.service';
import { BusinessesController } from './businesses.controller';
import { BusinessesRepository } from './businesses.repository';
import { BusinessesService } from './businesses.service';
import { TerminalsController } from './terminals.controller';
import { TerminalsRepository } from './terminals.repository';
import { TerminalsService } from './terminals.service';

/** Tenant side of a business: profile, branches, terminals. */
@Module({
  imports: [AuditLogsModule, StorageModule],
  controllers: [BusinessesController, BranchesController, TerminalsController],
  providers: [
    BusinessesRepository,
    BusinessesService,
    BusinessUpdateIdempotencyService,
    BranchesRepository,
    BranchesService,
    TerminalsRepository,
    TerminalsService,
  ],
})
export class BusinessesModule {}
