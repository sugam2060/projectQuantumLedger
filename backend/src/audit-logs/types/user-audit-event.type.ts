import type { AuditRequestContext } from './audit-request-context.type';

/** A business-user security event written to `access_logs`. */
export type UserAuditEvent = AuditRequestContext & {
  eventType: string;
  userId?: string | null;
  businessId?: string | null;
  metadata?: Record<string, unknown>;
};
