import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuditLogsService, type AuditRequestContext } from '../audit-logs';
import type { RequestSession } from '../database/database.types';
import { TerminalsRepository } from './terminals.repository';

/** Terminal lifecycle inside a business (activation today). */
@Injectable()
export class TerminalsService {
  private readonly logger = new Logger(TerminalsService.name);

  constructor(
    private readonly repository: TerminalsRepository,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async activateTerminal(
    businessId: string,
    branchId: string,
    terminalCode: string,
    session: RequestSession,
    auditContext: AuditRequestContext = {},
  ) {
    // terminal:activate was checked by PermissionGuard; RLS checks it again.
    try {
      return await this.repository.inSession(session, async (tx) => {
        const target = { businessId, branchId, terminalCode };
        await this.repository.setActivationContext(tx, target);
        const terminal = await this.repository.findByCode(tx, target);
        if (!terminal) throw new NotFoundException('Terminal was not found');
        if (terminal.status === 'active') return terminal;
        if (terminal.status !== 'inactive') {
          throw new ConflictException('Terminal cannot be activated');
        }
        const activated = await this.repository.activate(tx, terminal.id);
        if (!activated) {
          throw new ConflictException('Terminal cannot be activated');
        }
        await this.auditLogs.insertUserEvent(tx, {
          ...auditContext,
          userId: session.userId,
          businessId,
          eventType: 'TERMINAL_ACTIVATED',
          responseStatus: 200,
          metadata: { terminalId: terminal.id, branchId },
        });
        return activated;
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `Failed to activate terminal in branch ${branchId}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException(
        'Terminal activation is temporarily unavailable',
      );
    }
  }
}
