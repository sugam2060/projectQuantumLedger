import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcrypt';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import {
  accessAuditEvents,
  branchAssignments,
  branches,
  businessMemberships,
  businesses,
  membershipRoles,
  rolePermissions,
  roles,
  users,
} from '../database/schema/schema';
import { ACCESS_TOKEN_TTL_SECONDS } from './auth.constants';
import { AuthSessionService } from './auth-session.service';
import type { MembershipAuthorization } from './authenticated-user.interface';
import type { LoginDto } from './dto/login.dto';
import type { ClientType } from './pipes/client-type.pipe';

export interface AuthTokenResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: {
    id: string;
    email: string;
  };
  memberships: Array<{
    businessId: string;
    branchIds: string[];
  }>;
}

export interface AuthClientOptions {
  clientType: ClientType;
}

interface UserRecord {
  id: string;
  email: string;
  passwordHash: string | null;
  status: string;
}

interface MembershipRow {
  membershipId: string;
  businessId: string;
}

interface BranchRow {
  membershipId: string;
  branchId: string;
}

interface RolePermissionRow {
  membershipId: string;
  branchId: string | null;
  roleCode: string;
  permissionCode: string | null;
}

interface MembershipBuilder {
  businessId: string;
  branchIds: Set<string>;
  roles: Set<string>;
  permissions: Set<string>;
  branchAccess: Map<string, { roles: Set<string>; permissions: Set<string> }>;
}

interface AuthContext {
  user: Pick<UserRecord, 'id' | 'email'>;
  memberships: MembershipAuthorization[];
  roles: string[];
  permissions: string[];
}

const INVALID_CREDENTIAL_HASH =
  '$2b$10$RlO0ezAEbDPcjMzs3IQvGOWQx3MVODPppEHETusB5iMoDJmnIPg/m';

@Injectable()
export class AuthService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly authSessionService: AuthSessionService,
  ) {}

  async login(
    credentials: LoginDto,
    options: AuthClientOptions,
  ): Promise<AuthTokenResponse> {
    const user = await this.findUserByEmail(credentials.email);
    const passwordMatches = await compare(
      credentials.password,
      user?.passwordHash ?? INVALID_CREDENTIAL_HASH,
    );
    if (
      !user ||
      user.status !== 'active' ||
      !user.passwordHash ||
      !passwordMatches
    ) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const authContext = await this.loadAuthContext(user.id);
    return this.createSession(authContext, options, credentials.deviceLabel);
  }

  async refresh(
    refreshToken: string,
    options: AuthClientOptions,
  ): Promise<AuthTokenResponse> {
    const parsedToken = parseRefreshToken(refreshToken);
    if (!parsedToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const session = await this.authSessionService.get(parsedToken.sessionId);
    const currentHash = hashRefreshSecret(parsedToken.secret);
    if (
      !session ||
      session.clientType !== options.clientType ||
      !hasMatchingHash(session.refreshTokenHash, currentHash)
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const authContext = await this.loadAuthContext(session.userId);
    const nextSecret = randomBytes(32);
    const nextRefreshToken = Buffer.concat([
      parsedToken.sessionIdBytes,
      nextSecret,
    ]).toString('base64url');
    const nextHash = hashRefreshSecret(nextSecret.toString('base64url'));
    const accessToken = await this.signAccessToken(
      authContext,
      parsedToken.sessionId,
    );
    const rotated = await this.authSessionService.rotate(
      parsedToken.sessionId,
      currentHash,
      nextHash,
    );

    if (!rotated) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.tokenResponse(authContext, accessToken, nextRefreshToken);
  }

  async logout(sessionId: string): Promise<void> {
    await this.authSessionService.revoke(sessionId);
  }

  async logoutAll(userId: string, reason?: string): Promise<void> {
    await this.authSessionService.revokeAll(userId);
    await this.databaseService.db.insert(accessAuditEvents).values({
      actorUserId: userId,
      targetUserId: userId,
      action: 'auth.logout_all',
      reason: reason ?? null,
    });
  }

  private async createSession(
    authContext: AuthContext,
    options: AuthClientOptions,
    deviceLabel?: string,
  ): Promise<AuthTokenResponse> {
    const sessionIdBytes = randomBytes(16);
    const sessionId = sessionIdBytes.toString('base64url');
    const refreshSecret = randomBytes(32);
    const refreshToken = Buffer.concat([
      sessionIdBytes,
      refreshSecret,
    ]).toString('base64url');
    const accessToken = await this.signAccessToken(authContext, sessionId);

    await this.authSessionService.create(sessionId, {
      userId: authContext.user.id,
      clientType: options.clientType,
      refreshTokenHash: hashRefreshSecret(refreshSecret.toString('base64url')),
      ...(deviceLabel === undefined ? {} : { deviceLabel }),
    });

    return this.tokenResponse(authContext, accessToken, refreshToken);
  }

  private async signAccessToken(
    authContext: AuthContext,
    sessionId: string,
  ): Promise<string> {
    return this.jwtService.signAsync({
      sub: authContext.user.id,
      email: authContext.user.email,
      jti: sessionId,
      roles: authContext.roles,
      permissions: authContext.permissions,
      memberships: authContext.memberships,
    });
  }

  private tokenResponse(
    authContext: AuthContext,
    accessToken: string,
    refreshToken: string,
  ): AuthTokenResponse {
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      user: authContext.user,
      memberships: authContext.memberships.map((membership) => ({
        businessId: membership.businessId,
        branchIds: membership.branchIds,
      })),
    };
  }

  private async findUserByEmail(
    email: string,
  ): Promise<UserRecord | undefined> {
    return this.databaseService.db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select set_config('app.is_platform_support', 'true', true)`,
      );

      const [user] = await transaction
        .select({
          id: users.id,
          email: users.email,
          passwordHash: users.passwordHash,
          status: users.status,
        })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      return user;
    });
  }

  private async loadAuthContext(userId: string): Promise<AuthContext> {
    return this.databaseService.db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select set_config('app.is_platform_support', 'true', true)`,
      );

      const [user] = await transaction
        .select({
          id: users.id,
          email: users.email,
          passwordHash: users.passwordHash,
          status: users.status,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user || user.status !== 'active') {
        throw new UnauthorizedException('Invalid email or password');
      }

      const membershipRows: MembershipRow[] = await transaction
        .select({
          membershipId: businessMemberships.id,
          businessId: businessMemberships.businessId,
        })
        .from(businessMemberships)
        .innerJoin(
          businesses,
          eq(businesses.id, businessMemberships.businessId),
        )
        .where(
          and(
            eq(businessMemberships.userId, userId),
            eq(businessMemberships.status, 'active'),
            eq(businesses.status, 'active'),
          ),
        );

      if (membershipRows.length === 0) {
        return {
          user: { id: user.id, email: user.email },
          memberships: [],
          roles: [],
          permissions: [],
        };
      }

      const membershipIds = membershipRows.map((row) => row.membershipId);
      const branchRows: BranchRow[] = await transaction
        .select({
          membershipId: branchAssignments.businessMembershipId,
          branchId: branchAssignments.branchId,
        })
        .from(branchAssignments)
        .innerJoin(
          branches,
          and(
            eq(branches.id, branchAssignments.branchId),
            eq(branches.businessId, branchAssignments.businessId),
          ),
        )
        .where(
          and(
            inArray(branchAssignments.businessMembershipId, membershipIds),
            eq(branchAssignments.status, 'active'),
            eq(branches.status, 'active'),
          ),
        );

      const builders = new Map<string, MembershipBuilder>();
      const membershipIdToBusinessId = new Map<string, string>();
      for (const row of membershipRows) {
        builders.set(row.businessId, {
          businessId: row.businessId,
          branchIds: new Set(),
          roles: new Set(),
          permissions: new Set(),
          branchAccess: new Map(),
        });
        membershipIdToBusinessId.set(row.membershipId, row.businessId);
      }

      for (const row of branchRows) {
        builders
          .get(membershipIdToBusinessId.get(row.membershipId) ?? '')
          ?.branchIds.add(row.branchId);
      }

      const roleRows: RolePermissionRow[] = await transaction
        .select({
          membershipId: membershipRoles.businessMembershipId,
          branchId: membershipRoles.branchId,
          roleCode: roles.roleCode,
          permissionCode: rolePermissions.permissionCode,
        })
        .from(membershipRoles)
        .innerJoin(
          businessMemberships,
          and(
            eq(businessMemberships.id, membershipRoles.businessMembershipId),
            eq(businessMemberships.businessId, membershipRoles.businessId),
          ),
        )
        .innerJoin(
          roles,
          and(
            eq(roles.id, membershipRoles.roleId),
            eq(roles.businessId, membershipRoles.businessId),
          ),
        )
        .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
        .where(
          and(
            inArray(membershipRoles.businessMembershipId, membershipIds),
            eq(businessMemberships.userId, userId),
            eq(businessMemberships.status, 'active'),
          ),
        );

      for (const row of roleRows) {
        const businessId = membershipIdToBusinessId.get(row.membershipId);
        const membership = businessId ? builders.get(businessId) : undefined;
        if (!membership) {
          continue;
        }

        if (row.branchId === null) {
          membership.roles.add(row.roleCode);
          if (row.permissionCode !== null) {
            membership.permissions.add(row.permissionCode);
          }
          continue;
        }

        if (!membership.branchIds.has(row.branchId)) {
          continue;
        }

        let branchGrant = membership.branchAccess.get(row.branchId);
        if (!branchGrant) {
          branchGrant = { roles: new Set(), permissions: new Set() };
          membership.branchAccess.set(row.branchId, branchGrant);
        }
        branchGrant.roles.add(row.roleCode);
        if (row.permissionCode !== null) {
          branchGrant.permissions.add(row.permissionCode);
        }
      }

      const memberships = [...builders.values()]
        .map((membership) => ({
          businessId: membership.businessId,
          branchIds: [...membership.branchIds].sort(),
          roles: [...membership.roles].sort(),
          permissions: [...membership.permissions].sort(),
          branchAccess: [...membership.branchAccess.entries()]
            .map(([branchId, access]) => ({
              branchId,
              roles: [...access.roles].sort(),
              permissions: [...access.permissions].sort(),
            }))
            .sort((left, right) => left.branchId.localeCompare(right.branchId)),
        }))
        .sort((left, right) => left.businessId.localeCompare(right.businessId));

      return {
        user: { id: user.id, email: user.email },
        memberships,
        roles: [
          ...new Set(
            memberships.flatMap((m) => [
              ...m.roles,
              ...m.branchAccess.flatMap((branch) => branch.roles),
            ]),
          ),
        ].sort(),
        permissions: [
          ...new Set(
            memberships.flatMap((m) => [
              ...m.permissions,
              ...m.branchAccess.flatMap((branch) => branch.permissions),
            ]),
          ),
        ].sort(),
      };
    });
  }
}

function parseRefreshToken(
  token: string,
): { sessionId: string; sessionIdBytes: Buffer; secret: string } | undefined {
  if (!/^[A-Za-z0-9_-]{64}$/.test(token)) {
    return undefined;
  }

  const decoded = Buffer.from(token, 'base64url');
  if (decoded.length !== 48 || decoded.toString('base64url') !== token) {
    return undefined;
  }

  const sessionIdBytes = decoded.subarray(0, 16);
  return {
    sessionId: sessionIdBytes.toString('base64url'),
    sessionIdBytes,
    secret: decoded.subarray(16).toString('base64url'),
  };
}

function hashRefreshSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('base64url');
}

function hasMatchingHash(storedHash: string, presentedHash: string): boolean {
  const stored = Buffer.from(storedHash);
  const presented = Buffer.from(presentedHash);

  return (
    stored.length === presented.length && timingSafeEqual(stored, presented)
  );
}
