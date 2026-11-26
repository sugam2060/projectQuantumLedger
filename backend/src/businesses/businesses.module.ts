import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs';
import { AuthenticationModule } from '../authentication';
import { EmailModule } from '../jobs/email';
import { StorageModule } from '../storage';
import { BranchesController } from './branches.controller';
import { BranchesRepository } from './branches.repository';
import { BranchesService } from './branches.service';
import { BusinessUpdateIdempotencyService } from './business-update-idempotency.service';
import { BusinessesController } from './businesses.controller';
import { BusinessesRepository } from './businesses.repository';
import { BusinessesService } from './businesses.service';
import { InvitationsController } from './invitations.controller';
import { InvitationsRepository } from './invitations.repository';
import { InvitationsService } from './invitations.service';
import { MembersController } from './members.controller';
import { MembersRepository } from './members.repository';
import { MembersService } from './members.service';
import { MyInvitationsController } from './my-invitations.controller';
import { MyInvitationsService } from './my-invitations.service';
import { RolesController } from './roles.controller';
import { RolesRepository } from './roles.repository';
import { RolesService } from './roles.service';
import { TerminalsController } from './terminals.controller';
import { TerminalsRepository } from './terminals.repository';
import { TerminalsService } from './terminals.service';

/** Tenant side of a business: profile, branches, terminals, roles, members, invitations. */
@Module({
  imports: [AuditLogsModule, StorageModule, AuthenticationModule, EmailModule],
  controllers: [
    BusinessesController,
    BranchesController,
    TerminalsController,
    RolesController,
    MembersController,
    InvitationsController,
    MyInvitationsController,
  ],
  providers: [
    BusinessesRepository,
    BusinessesService,
    BusinessUpdateIdempotencyService,
    BranchesRepository,
    BranchesService,
    TerminalsRepository,
    TerminalsService,
    RolesRepository,
    RolesService,
    MembersRepository,
    MembersService,
    InvitationsRepository,
    InvitationsService,
    MyInvitationsService,
  ],
})
export class BusinessesModule {}
