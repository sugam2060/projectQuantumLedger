import type { AuditRequestContext } from './audit-request-context.type';

/** A platform-staff event written to `platform_audit_logs`. */
export type PlatformAuditEvent = AuditRequestContext & {
  action: string;
  platformUserId: string;
  businessId?: string | null;
  provisioningRequestId?: string | null;
  metadata?: Record<string, unknown>;
};
