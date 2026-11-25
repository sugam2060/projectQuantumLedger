/** Shape of the `auth` config namespace (see `auth.config.ts`). */
export type AuthConfig = {
  /** HS256 signing secret for access tokens. Validated to be at least 32 characters. */
  jwtSecret: string;
};
