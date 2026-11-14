import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import {
  businessMemberships,
  branches,
  endpointRoleAccess,
  roles,
  terminals,
  users,
} from '../database/schema';
import type { AuthenticatedUser } from './strategies/jwt.strategy';
import { ClientLoginDTO, ClientType } from './dto/clientLogin.dto';
import { UtilsService } from '../utils/utils.service';
import { RedisService } from '../redis/redis.service';
import { EndpointAccessCatalogService } from '../roles-permissions/endpoint-access-catalog.service';
import { EffectivePermissionsCacheService } from '../roles-permissions/effective-permissions-cache.service';
import bcrypt from 'bcryptjs';

type UserAuthTransaction = Parameters<
  Parameters<DatabaseService['transaction']>[0]
>[0];

@Injectable()
export class UserAuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly utilsService: UtilsService,
    private readonly redisService: RedisService,
    private readonly endpointCatalog: EndpointAccessCatalogService,
    private readonly permissionsCache: EffectivePermissionsCacheService,
  ) {}

  async userLogin(dto: ClientLoginDTO, requestedTerminalId: string) {
    // Ensure email exists and is a string before processing
    if (!dto.email || typeof dto.email !== 'string') {
      throw new BadRequestException('Valid email is required');
    }

    // Ensure password exists and is a string before processing
    if (!dto.password || typeof dto.password !== 'string') {
      throw new BadRequestException('Valid password is required');
    }

    const email = dto.email.trim().toLowerCase();
    const expiresIn = dto.remember ? '7d' : '15m';

    return this.db.transaction(async (tx) => {
      // Login has no authenticated user context yet, so enable the platform
      // read policy for the user lookup and terminal validation in this
      // transaction only.
      await tx.execute(sql`
        SELECT set_config('app.is_platform_user', 'true', true)
      `);

      // Single optimized query to fetch user, memberships, and roles using JOINs
      const userData = await tx
        .select({
          userId: users.id,
          userEmail: users.emailNormalized,
          userName: users.name,
          userPasswordHash: users.passwordHash,
          userStatus: users.status,
          businessId: businessMemberships.businessId,
          branchId: businessMemberships.branchId,
          isOwner: businessMemberships.isOwner,
          roleId: businessMemberships.roleId,
          roleName: roles.name,
          roleVersion: roles.version,
          rolePermissions: roles.permissions,
        })
        .from(users)
        .leftJoin(
          businessMemberships,
          and(
            eq(users.id, businessMemberships.userId),
            eq(businessMemberships.isActive, true),
          ),
        )
        .leftJoin(roles, eq(businessMemberships.roleId, roles.id))
        .where(
          and(eq(users.emailNormalized, email), eq(users.status, 'active')),
        );

      // Check if user exists
      if (userData.length === 0 || !userData[0].userId) {
        throw new UnauthorizedException('Invalid email or password');
      }

      // Verify password using the first record
      const firstRecord = userData[0];
      if (!(await bcrypt.compare(dto.password, firstRecord.userPasswordHash))) {
        throw new UnauthorizedException('Invalid email or password');
      }

      const [terminal] = await tx
        .select({
          terminalId: terminals.id,
          businessId: terminals.businessId,
          branchId: terminals.branchId,
        })
        .from(terminals)
        .innerJoin(
          branches,
          and(
            eq(branches.id, terminals.branchId),
            eq(branches.businessId, terminals.businessId),
          ),
        )
        .where(
          and(
            eq(terminals.id, requestedTerminalId),
            eq(terminals.status, 'active'),
          ),
        );

      const selectedMembership = userData.find(
        (record) =>
          terminal &&
          record.businessId === terminal.businessId &&
          (record.branchId === null || record.branchId === terminal.branchId),
      );
      if (!terminal || !selectedMembership) {
        throw new UnauthorizedException(
          'Terminal is not active for an assigned business branch',
        );
      }

      // Process the joined results to separate user data from memberships
      const user = {
        id: firstRecord.userId,
        email: firstRecord.userEmail,
        name: firstRecord.userName,
      };

      // Group membership data by businessId to avoid duplicates
      const membershipMap = new Map();
      userData.forEach((record) => {
        if (record.businessId) {
          const key = `${record.businessId}-${record.roleId}`;
          if (!membershipMap.has(key)) {
            membershipMap.set(key, {
              businessId: record.businessId,
              branchId: record.branchId,
              isOwner: record.isOwner,
              roleId: record.roleId,
              role: record.roleName,
              roleVersion: record.roleVersion,
              permissions: this.readPermissions(record.rolePermissions),
            });
          }
        }
      });

      const membershipsWithRoles = Array.from(membershipMap.values());

      const activeMembership = {
        ...membershipsWithRoles.find(
          (membership) =>
            membership.businessId === selectedMembership.businessId &&
            (membership.branchId === null ||
              membership.branchId === terminal.branchId),
        ),
        branchId: terminal.branchId,
      };
      const effectivePermissions = await this.getEffectivePermissions(
        tx,
        activeMembership.businessId,
        activeMembership.roleId,
        activeMembership.permissions,
      );
      await this.permissionsCache.set(
        activeMembership.businessId,
        activeMembership.roleId,
        {
          permissions: effectivePermissions,
          roleVersion: activeMembership.roleVersion ?? null,
        },
      );
      await tx.execute(sql`
        SELECT
          set_config('app.is_platform_user', 'false', true),
          set_config('app.user_id', ${firstRecord.userId}, true)
      `);
      const accessToken = await this.jwtService.signAsync(
        {
          sub: user.id,
          name: user.name,
          isPlatform: false,
          businessId: activeMembership.businessId,
          branchId: activeMembership.branchId ?? undefined,
          isOwner: activeMembership.isOwner,
          role_id: activeMembership.roleId,
          role_version: activeMembership.roleVersion,
        },
        { expiresIn },
      );

      // Generate refresh token if remember is true
      let refreshToken: string | undefined;
      if (dto.remember) {
        refreshToken = this.utilsService.generateRefreshToken();
        // Store refresh token in Redis with 7-day expiration
        await this.redisService.set(
          `refresh_token:${refreshToken}`,
          user.id,
          7 * 24 * 60 * 60,
        );
      }

      return {
        accessToken,
        ...(refreshToken && { refreshToken }),
        tokenType: 'Bearer',
        expiresIn,
        user,
        memberships: membershipsWithRoles.map(
          ({ permissions: _permissions, ...membership }) => membership,
        ),
        effectivePermissions,
      };
    });
  }

  async getCurrentUser(
    authenticatedUser: AuthenticatedUser,
    clientType: ClientType,
    requestedTerminalId: string,
    initialLoad = true,
  ) {
    const { userId, businessId, branchId, name, roleId, roleVersion } =
      authenticatedUser;
    if (!userId || authenticatedUser.isPlatform || name === undefined) {
      throw new UnauthorizedException('A user access token is required');
    }
    let effectivePermissions: string[] | undefined;
    let currentRoleVersion = roleVersion;
    if (initialLoad) {
      effectivePermissions = [];
      if (businessId && roleId) {
        let snapshot = await this.permissionsCache.get(businessId, roleId);
        if (!snapshot) {
          snapshot = await this.db.transactionWithSession(
            authenticatedUser,
            async (tx) => {
              const [role] = await tx
                .select({
                  permissions: roles.permissions,
                  version: roles.version,
                })
                .from(roles)
                .where(eq(roles.id, roleId))
                .limit(1);
              if (!role) return null;

              const permissions = await this.getEffectivePermissions(
                tx,
                businessId,
                roleId,
                this.readPermissions(role.permissions),
              );
              return {
                permissions,
                roleVersion: role.version,
              };
            },
          );
          if (snapshot) {
            await this.permissionsCache.set(businessId, roleId, snapshot);
          }
        }
        if (snapshot) {
          effectivePermissions = snapshot.permissions;
          currentRoleVersion = snapshot.roleVersion ?? roleVersion;
        }
      }
    }

    const now = Math.floor(Date.now() / 1000);
    const tokenExpiresAt = authenticatedUser.tokenExpiresAt;
    const issuedAt = authenticatedUser.tokenIssuedAt;

    return {
      user: {
        id: userId,
        name,
      },
      activeContext: businessId
        ? { businessId, branchId: branchId ?? null }
        : null,
      is_owner: authenticatedUser.isOwner === true,
      role_template: roleId ?? null,
      role_template_version:
        currentRoleVersion === undefined ? null : String(currentRoleVersion),
      ...(effectivePermissions && { effectivePermissions }),
      session: {
        clientType,
        terminalId: requestedTerminalId,
        issuedAt: issuedAt ? new Date(issuedAt * 1000).toISOString() : null,
        expiresAt: tokenExpiresAt
          ? new Date(tokenExpiresAt * 1000).toISOString()
          : null,
        expiresInSeconds:
          tokenExpiresAt === undefined
            ? null
            : Math.max(0, tokenExpiresAt - now),
      },
    };
  }

  private readPermissions(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter(
      (permission): permission is string => typeof permission === 'string',
    );
  }

  private async getEffectivePermissions(
    tx: UserAuthTransaction,
    businessId: string,
    roleId: string,
    rolePermissions: string[],
  ): Promise<string[]> {
    const configurations = await tx
      .select({
        endpointKey: endpointRoleAccess.endpointKey,
        roleId: endpointRoleAccess.roleId,
      })
      .from(endpointRoleAccess)
      .where(eq(endpointRoleAccess.businessId, businessId));

    const configuredRolesByEndpoint = new Map<string, Set<string>>();
    for (const configuration of configurations) {
      const roleIds =
        configuredRolesByEndpoint.get(configuration.endpointKey) ??
        new Set<string>();
      roleIds.add(configuration.roleId);
      configuredRolesByEndpoint.set(configuration.endpointKey, roleIds);
    }

    const effectivePermissions = new Set<string>();
    const catalog = this.endpointCatalog.list();
    const catalogKeys = new Set(catalog.map((entry) => entry.endpointKey));
    for (const permission of rolePermissions) {
      const allowedRoleIds = configuredRolesByEndpoint.get(permission);
      if (
        !catalogKeys.has(permission) ||
        !allowedRoleIds ||
        allowedRoleIds.has(roleId)
      ) {
        effectivePermissions.add(permission);
      }
    }
    for (const endpoint of catalog) {
      const allowedRoleIds = configuredRolesByEndpoint.get(
        endpoint.endpointKey,
      );
      if (!allowedRoleIds || allowedRoleIds.has(roleId)) {
        effectivePermissions.add(endpoint.endpointKey);
      }
    }

    return [...effectivePermissions].sort();
  }

  /**
   * Invalidates a refresh token
   * @param refreshToken Refresh token to invalidate
   */
  async invalidateRefreshToken(refreshToken: string): Promise<void> {
    await this.redisService.delete(`refresh_token:${refreshToken}`);
  }

  /**
   * Refreshes the access token using a valid refresh token
   * @param refreshToken Refresh token
   * @returns New access token and optional new refresh token
   */
  async refreshAccessToken(
    refreshToken: string,
    requestedTerminalId: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    tokenType: 'Bearer';
    expiresIn: '15m';
    user: { id: string; email: string; name: string };
    effectivePermissions: string[];
  }> {
    // Check if refresh token exists in Redis
    const userId = await this.redisService.get(`refresh_token:${refreshToken}`);
    if (!userId) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const session = await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT set_config('app.is_platform_user', 'true', true)
      `);

      const userRows = await tx
        .select({
          userId: users.id,
          email: users.emailNormalized,
          name: users.name,
          status: users.status,
          businessId: businessMemberships.businessId,
          branchId: businessMemberships.branchId,
          isOwner: businessMemberships.isOwner,
          roleId: roles.id,
          roleVersion: roles.version,
          permissions: roles.permissions,
        })
        .from(users)
        .leftJoin(
          businessMemberships,
          and(
            eq(businessMemberships.userId, users.id),
            eq(businessMemberships.isActive, true),
          ),
        )
        .leftJoin(roles, eq(roles.id, businessMemberships.roleId))
        .where(and(eq(users.id, userId), eq(users.status, 'active')));

      const user = userRows[0];
      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      const [terminal] = await tx
        .select({
          terminalId: terminals.id,
          businessId: terminals.businessId,
          branchId: terminals.branchId,
        })
        .from(terminals)
        .innerJoin(
          branches,
          and(
            eq(branches.id, terminals.branchId),
            eq(branches.businessId, terminals.businessId),
          ),
        )
        .where(
          and(
            eq(terminals.id, requestedTerminalId),
            eq(terminals.status, 'active'),
          ),
        );

      const membership = userRows.find(
        (row) =>
          terminal &&
          row.businessId === terminal.businessId &&
          (row.branchId === null || row.branchId === terminal.branchId),
      );
      if (!terminal || !membership || !membership.roleId) {
        throw new UnauthorizedException(
          'Terminal is not active for an assigned business branch',
        );
      }

      const effectivePermissions = await this.getEffectivePermissions(
        tx,
        membership.businessId!,
        membership.roleId,
        this.readPermissions(membership.permissions),
      );
      await this.permissionsCache.set(
        membership.businessId!,
        membership.roleId,
        {
          permissions: effectivePermissions,
          roleVersion: membership.roleVersion ?? null,
        },
      );

      await tx.execute(sql`
        SELECT
          set_config('app.is_platform_user', 'false', true),
          set_config('app.user_id', ${user.userId}, true)
      `);

      const accessToken = await this.jwtService.signAsync(
        {
          sub: user.userId,
          name: user.name,
          isPlatform: false,
          businessId: membership.businessId,
          branchId: terminal.branchId,
          isOwner: membership.isOwner,
          role_id: membership.roleId,
          role_version: membership.roleVersion,
        },
        { expiresIn: '15m' },
      );

      return {
        accessToken,
        effectivePermissions,
        user: {
          id: user.userId,
          email: user.email,
          name: user.name,
        },
      };
    });

    // Optionally generate a new refresh token (refresh token rotation)
    // This adds an extra layer of security by rotating refresh tokens
    const newRefreshToken = this.utilsService.generateRefreshToken();
    await this.redisService.set(
      `refresh_token:${newRefreshToken}`,
      userId,
      7 * 24 * 60 * 60,
    );

    // Invalidate the old refresh token
    await this.invalidateRefreshToken(refreshToken);

    return {
      accessToken: session.accessToken,
      refreshToken: newRefreshToken,
      tokenType: 'Bearer',
      expiresIn: '15m',
      user: session.user,
      effectivePermissions: session.effectivePermissions,
    };
  }
}
