import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { AuditContext, type AuditRequestContext } from '../audit-logs';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types';
import { ActivateTerminalDto, BusinessBranchParamDto } from './dto';
import { TerminalsService } from './terminals.service';
import { requireBusinessOwner } from './utils/business-access.util';

/** Terminal administration inside a branch. */
@Controller('businesses')
export class TerminalsController {
  constructor(private readonly terminals: TerminalsService) {}

  @Post(':businessId/branches/:branchId/terminals/activate')
  @HttpCode(HttpStatus.OK)
  activateTerminal(
    @Param() params: BusinessBranchParamDto,
    @Body() dto: ActivateTerminalDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @AuditContext() auditContext: AuditRequestContext,
  ) {
    const owner = requireBusinessOwner(user, params.businessId);
    return this.terminals.activateTerminal(
      params.businessId,
      params.branchId,
      dto.terminalCode.trim().toUpperCase(),
      owner,
      auditContext,
    );
  }
}
