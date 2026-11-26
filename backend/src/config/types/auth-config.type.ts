/** Shape of the `auth` config namespace (see `auth.config.ts`). */
export type AuthConfig = {
  /** HS256 signing secret for access tokens (>= 32 characters). */
  jwtSecret: string;
  /** Access-token lifetime as configured (e.g. "15m"), echoed to clients. */
  accessTtl: string;
  accessTtlSeconds: number;
  /** `iss` claim on every access token. */
  issuer: string;
  /** `aud` for business-user tokens. */
  audience: string;
  /** `aud` for platform-user tokens; a user token is never valid on platform routes. */
  platformAudience: string;
  /** Refresh lifetime when the user asked to be remembered. */
  refreshPersistentTtlSeconds: number;
  /** Refresh lifetime otherwise (browser session cookie). */
  refreshSessionTtlSeconds: number;
  /** Lifetime of an emailed password-reset link. */
  passwordResetTtlMinutes: number;
};
