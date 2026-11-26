import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuditContext, type AuditRequestContext } from '../audit-logs';
import {
  BranchId,
  BusinessId,
  Permission,
  RequiredPermission,
} from '../authorization';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types';
import { ActivateTerminalDto } from './dto';
import { TerminalsService } from './terminals.service';

/** Terminal administration inside a branch. */
@Controller('businesses')
export class TerminalsController {
  constructor(private readonly terminals: TerminalsService) {}

  @Post(':businessId/branches/:branchId/terminals/activate')
  @HttpCode(HttpStatus.OK)
  @RequiredPermission(Permission.TERMINAL_ACTIVATE)
  activateTerminal(
    @BusinessId() businessId: string,
    @BranchId() branchId: string,
    @Body() dto: ActivateTerminalDto,
    @CurrentUser() user: AuthenticatedUser,
    @AuditContext() auditContext: AuditRequestContext,
  ) {
    return this.terminals.activateTerminal(
      businessId,
      branchId,
      dto.terminalCode.trim().toUpperCase(),
      user,
      auditContext,
    );
  }
}
