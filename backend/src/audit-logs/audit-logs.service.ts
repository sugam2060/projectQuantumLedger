import { Injectable, Logger } from '@nestjs/common';
import type { RequestSession } from '../database/request_context.service';
import { AuditLogsRepository } from './audit-logs.repository';
import type {
  AuditTransaction,
  PlatformAuditEvent,
  UserAuditEvent,
} from './types';

/**
 * Security/access audit trail. `insert*` joins the caller's transaction so the audit
 * row commits with the change it records. `log*` writes on its own and never throws;
 * use it on failure paths where the main transaction already rolled back.
 */
@Injectable()
export class AuditLogsService {
  private readonly logger = new Logger(AuditLogsService.name);

  constructor(private readonly repository: AuditLogsRepository) {}

  insertUserEvent(tx: AuditTransaction, event: UserAuditEvent) {
    return this.repository.insertUserEvent(tx, event);
  }

  insertPlatformEvent(tx: AuditTransaction, event: PlatformAuditEvent) {
    return this.repository.insertPlatformEvent(tx, event);
  }

  async logUserEvent(
    session: RequestSession,
    event: UserAuditEvent,
  ): Promise<void> {
    try {
      await this.repository.writeUserEvent(session, event);
    } catch {
      this.logger.warn(`Could not persist user audit event ${event.eventType}`);
    }
  }

  async logPlatformEvent(event: PlatformAuditEvent): Promise<void> {
    try {
      await this.repository.writePlatformEvent(event);
    } catch {
      this.logger.warn(
        `Could not persist platform audit event ${event.action}`,
      );
    }
  }
}
