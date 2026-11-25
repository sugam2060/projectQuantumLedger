import type { AuditRequestContext } from '../../audit-logs';
import type { ClientType } from '../dto/client-login.dto';

/** Request details a sign-in records on the session and in the audit log. */
export type AuthMetadata = {
  clientType: ClientType;
  terminalId?: string;
  userAgent?: string;
  ip?: string;
  audit: AuditRequestContext;
};

/**
 * Login / refresh result for business users. `refreshToken` and its lifetime go to
 * the controller, which puts them in a cookie (browsers) or in the body (native).
 */
export type UserAuthResult = {
  accessToken: string;
  refreshToken: string;
  refreshMaxAgeMs: number | undefined;
  tokenType: 'Bearer';
  expiresIn: string;
  user: { id: string; email: string; name: string };
  memberships: Array<{
    businessId: string;
    branchId: string | null;
    isOwner: boolean;
    roleId: string | null;
    role: string | null;
    roleVersion: number | null;
  }>;
  effectivePermissions: string[];
};

/** Login / refresh result for platform users. */
export type PlatformAuthResult = {
  accessToken: string;
  refreshToken: string;
  refreshMaxAgeMs: number | undefined;
  tokenType: 'Bearer';
  expiresIn: number;
  user: { id: string; displayName: string };
  isPlatform: true;
  isBootstrap: boolean;
};
