import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type { RequestSession } from '../database/database.types';
import { accessLogs } from '../database/schemas/audit/access-logs';
import { platformAuditLogs } from '../database/schemas/audit/platform-audit-logs';
import type {
  AuditTransaction,
  PlatformAuditEvent,
  UserAuditEvent,
} from './types';

/** All SQL for the audit tables. */
@Injectable()
export class AuditLogsRepository {
  constructor(private readonly database: DatabaseService) {}

  insertUserEvent(tx: AuditTransaction, event: UserAuditEvent) {
    return tx.insert(accessLogs).values({
      userId: event.userId ?? null,
      businessId: event.businessId ?? null,
      eventType: event.eventType,
      httpMethod: event.method ?? null,
      endpointPath: event.endpointPath ?? null,
      responseStatus: event.responseStatus ?? null,
      requestId: event.requestId ?? null,
      clientType: event.clientType ?? null,
      terminalId: event.terminalId ?? null,
      ipAddress: event.ipAddress ?? null,
      userAgent: event.userAgent ?? null,
      metadata: event.metadata ?? {},
    });
  }

  insertPlatformEvent(tx: AuditTransaction, event: PlatformAuditEvent) {
    return tx.insert(platformAuditLogs).values({
      platformUserId: event.platformUserId,
      businessId: event.businessId ?? null,
      requestId: event.provisioningRequestId ?? null,
      action: event.action,
      httpMethod: event.method ?? null,
      endpointPath: event.endpointPath ?? null,
      responseStatus: event.responseStatus ?? null,
      correlationId: event.requestId ?? null,
      clientType: event.clientType ?? null,
      ipAddress: event.ipAddress ?? null,
      userAgent: event.userAgent ?? null,
      metadata: event.metadata ?? {},
    });
  }

  /** Writes a user event in its own transaction under the caller's RLS session. */
  async writeUserEvent(
    session: RequestSession,
    event: UserAuditEvent,
  ): Promise<void> {
    await this.database.transactionWithSession(session, (tx) =>
      this.insertUserEvent(tx, event),
    );
  }

  /** Writes a platform event in its own transaction under a platform RLS session. */
  async writePlatformEvent(event: PlatformAuditEvent): Promise<void> {
    await this.database.transactionWithSession(
      { isPlatform: true, platformUserId: event.platformUserId },
      (tx) => this.insertPlatformEvent(tx, event),
    );
  }
}
