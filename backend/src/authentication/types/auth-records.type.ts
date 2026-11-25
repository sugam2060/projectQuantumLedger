/** Account row returned by the pre-auth email lookup (includes the hash). */
export type UserCredential = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  status: string;
};

/** The current user's account without the hash. */
export type UserAccount = {
  id: string;
  email: string;
  name: string;
  status: string;
};

export type PlatformCredential = UserCredential & { isBootstrap: boolean };
export type PlatformAccount = UserAccount & { isBootstrap: boolean };

/** One active membership with its role summary. */
export type ActiveMembership = {
  membershipId: string;
  businessId: string;
  branchId: string | null;
  isOwner: boolean;
  roleId: string | null;
  roleName: string | null;
  roleVersion: number | null;
};

export type ActiveTerminal = {
  id: string;
  businessId: string;
  branchId: string;
};

/** Which account a session belongs to: exactly one of the two ids. */
export type SessionActor =
  | { userId: string; platformUserId?: undefined }
  | { platformUserId: string; userId?: undefined };

export type NewSession = {
  tokenHash: string;
  clientType: string;
  terminalId: string | null;
  persistent: boolean;
  userAgent: string | null;
  ip: string | null;
  expiresAt: Date;
};

export type RotationOutcome = 'rotated' | 'reuse' | 'invalid';

export type RotationResult = {
  outcome: RotationOutcome;
  sessionId: string | null;
  userId: string | null;
  platformUserId: string | null;
  clientType: string | null;
  terminalId: string | null;
  persistent: boolean;
  expiresAt: Date | null;
};
