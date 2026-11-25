import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { accessLogs } from './schemas/audit/access-logs';
import { platformAuditLogs } from './schemas/audit/platform-audit-logs';
import type { RequestSession } from './request_context.service';

export interface AuditRequestContext {
  method?: string;
  endpointPath?: string;
  responseStatus?: number;
  requestId?: string;
  clientType?: string;
  terminalId?: string;
  ipAddress?: string;
  userAgent?: string;
}

type AuditTransaction = Parameters<
  Parameters<DatabaseService['transactionWithSession']>[1]
>[0];

export interface UserAuditEvent extends AuditRequestContext {
  eventType: string;
  userId?: string | null;
  businessId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface PlatformAuditEvent extends AuditRequestContext {
  action: string;
  platformUserId: string;
  businessId?: string | null;
  provisioningRequestId?: string | null;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

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

  async logUserEvent(session: RequestSession, event: UserAuditEvent) {
    try {
      await this.database.transactionWithSession(session, (tx) =>
        this.insertUserEvent(tx, event),
      );
    } catch {
      this.logger.warn(`Could not persist user audit event ${event.eventType}`);
    }
  }

  async logPlatformEvent(event: PlatformAuditEvent) {
    try {
      await this.database.transactionWithSession(
        { isPlatform: true, platformUserId: event.platformUserId },
        (tx) => this.insertPlatformEvent(tx, event),
      );
    } catch {
      this.logger.warn(
        `Could not persist platform audit event ${event.action}`,
      );
    }
  }
}
