/** Claims of a business-user access token (audience JWT_AUDIENCE). */
export type UserAccessTokenClaims = {
  sub: string;
  email: string;
  name: string;
  businessId: string;
  /** Branch the session works in: the terminal's branch, else the membership's. */
  branchId?: string;
  terminalId?: string;
  isOwner: boolean;
  role_id?: string;
  role_version?: number;
};

/** Claims of a platform-user access token (audience JWT_PLATFORM_AUDIENCE). */
export type PlatformAccessTokenClaims = {
  sub: string;
  platformUserId: string;
  email: string;
  isPlatform: true;
  isBootstrap: boolean;
};

export type SignedAccessToken = {
  token: string;
  /** Configured lifetime, e.g. "15m". */
  expiresIn: string;
  expiresInSeconds: number;
};
