import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import {
  businessMemberships,
  business,
  branches,
  endpointRoleAccess,
  roles,
  terminals,
  users,
  ownerRedemptions,
} from '../database/schema';
import type { AuthenticatedUser } from './strategies/jwt.strategy';
import { ClientLoginDTO, ClientType } from './dto/clientLogin.dto';
import { UtilsService } from '../utils/utils.service';
import { RedisService } from '../redis/redis.service';
import { EndpointAccessCatalogService } from '../roles-permissions/endpoint-access-catalog.service';
import { EffectivePermissionsCacheService } from '../roles-permissions/effective-permissions-cache.service';
import bcrypt from 'bcryptjs';
import type { OwnerRegistrationDto } from './dto/owner-registration.dto';
import {
  AuditLogService,
  type AuditRequestContext,
} from '../database/audit-log.service';

type UserAuthTransaction = Parameters<
  Parameters<DatabaseService['transaction']>[0]
>[0];

interface UserRefreshSession {
  accessToken: string;
  effectivePermissions: string[];
  user: { id: string; email: string; name: string };
}

@Injectable()
export class UserAuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly utilsService: UtilsService,
    private readonly redisService: RedisService,
    private readonly endpointCatalog: EndpointAccessCatalogService,
    private readonly permissionsCache: EffectivePermissionsCacheService,
    private readonly auditLogs: AuditLogService,
  ) {}

  async userLogin(
    dto: ClientLoginDTO,
    requestedTerminalId: string,
    auditContext: AuditRequestContext = {},
  ) {
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
    let identifiedUserId: string | undefined;
    let identifiedBusinessId: string | undefined;

    try {
      return await this.db.transaction(async (tx) => {
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
        identifiedUserId = firstRecord.userId;
        identifiedBusinessId =
          userData.find((record) => record.businessId)?.businessId ?? undefined;
        if (
          !(await bcrypt.compare(dto.password, firstRecord.userPasswordHash))
        ) {
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
        const effectivePermissions = activeMembership.roleId
          ? await this.getEffectivePermissions(
              tx,
              activeMembership.businessId,
              activeMembership.roleId,
              activeMembership.permissions,
            )
          : [];
        if (activeMembership.roleId) {
          await this.permissionsCache.set(
            activeMembership.businessId,
            activeMembership.roleId,
            {
              permissions: effectivePermissions,
              roleVersion: activeMembership.roleVersion ?? null,
            },
          );
        }
        await tx.execute(sql`
        SELECT
          set_config('app.is_platform_user', 'false', true),
          set_config('app.user_id', ${firstRecord.userId}, true),
          set_config('app.business_id', ${activeMembership.businessId}, true),
          set_config('app.branch_id', ${activeMembership.branchId ?? ''}, true)
      `);
        await this.auditLogs.insertUserEvent(tx, {
          ...auditContext,
          userId: user.id,
          businessId: activeMembership.businessId,
          terminalId: requestedTerminalId,
          eventType: 'USER_LOGIN_SUCCESS',
          responseStatus: 200,
        });
        const accessToken = await this.jwtService.signAsync(
          {
            sub: user.id,
            name: user.name,
            isPlatform: false,
            businessId: activeMembership.businessId,
            branchId: activeMembership.branchId ?? undefined,
            isOwner: activeMembership.isOwner,
            ...(activeMembership.roleId
              ? {
                  role_id: activeMembership.roleId,
                  role_version: activeMembership.roleVersion ?? undefined,
                }
              : {}),
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
    } catch (error) {
      if (identifiedUserId) {
        await this.auditLogs.logUserEvent(
          { userId: identifiedUserId, businessId: identifiedBusinessId },
          {
            ...auditContext,
            userId: identifiedUserId,
            businessId: identifiedBusinessId,
            terminalId: requestedTerminalId,
            eventType: 'USER_LOGIN_FAILED',
            responseStatus: 401,
          },
        );
      }
      throw error;
    }
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

  async registerOwner(
    dto: OwnerRegistrationDto,
    auditContext: AuditRequestContext = {},
  ) {
    const email = dto.email.trim().toLowerCase();
    const tokenHash = createHash('sha256')
      .update(dto.redeemCode.trim())
      .digest('hex');

    try {
      return await this.db.transactionWithSession({}, async (tx) => {
        await tx.execute(sql`
          SELECT
            set_config('app.owner_redemption_hash', ${tokenHash}, true),
            set_config('app.registration_email', ${email}, true)
        `);

        const [redemption] = await tx
          .select({
            id: ownerRedemptions.id,
            businessId: ownerRedemptions.businessId,
            email: ownerRedemptions.emailNormalized,
          })
          .from(ownerRedemptions)
          .where(
            and(
              eq(ownerRedemptions.tokenHash, tokenHash),
              isNull(ownerRedemptions.consumedAt),
              isNull(ownerRedemptions.revokedAt),
              gt(ownerRedemptions.expiresAt, new Date()),
            ),
          )
          .limit(1)
          .for('update');
        if (!redemption || redemption.email !== email) {
          throw new UnauthorizedException('Invalid or expired redemption code');
        }

        await tx.execute(sql`
          SELECT
            set_config('app.business_id', ${redemption.businessId}, true),
            set_config('app.is_owner', 'true', true)
        `);
        const [businessRecord] = await tx
          .select({ id: business.id, isActive: business.isActive })
          .from(business)
          .where(eq(business.id, redemption.businessId))
          .limit(1);
        if (!businessRecord)
          throw new NotFoundException('Business was not found');
        if (businessRecord.isActive) {
          throw new ConflictException('Business has already been activated');
        }

        const [existingUser] = await tx
          .select({
            id: users.id,
            passwordHash: users.passwordHash,
            status: users.status,
          })
          .from(users)
          .where(eq(users.emailNormalized, email))
          .limit(1);

        let userId: string;
        if (existingUser) {
          if (
            existingUser.status !== 'active' ||
            !(await bcrypt.compare(dto.password, existingUser.passwordHash))
          ) {
            throw new UnauthorizedException('Invalid email or password');
          }
          userId = existingUser.id;
        } else {
          const passwordHash = await bcrypt.hash(dto.password, 10);
          const [createdUser] = await tx
            .insert(users)
            .values({
              emailNormalized: email,
              passwordHash,
              name: dto.name.trim(),
              status: 'active',
            })
            .returning({ id: users.id });
          if (!createdUser) throw new Error('Owner user could not be created');
          userId = createdUser.id;
        }

        await tx.execute(sql`
          SELECT
            set_config('app.user_id', ${userId}, true),
            set_config('app.is_platform_user', 'false', true),
            set_config('app.branch_id', '', true)
        `);
        await tx.insert(businessMemberships).values({
          businessId: redemption.businessId,
          userId,
          roleId: null,
          branchId: null,
          isOwner: true,
          isActive: true,
        });
        await tx
          .update(business)
          .set({ isActive: true, updatedAt: new Date() })
          .where(eq(business.id, redemption.businessId));
        await tx
          .update(ownerRedemptions)
          .set({ consumedAt: new Date(), consumedByUserId: userId })
          .where(eq(ownerRedemptions.id, redemption.id));

        await this.auditLogs.insertUserEvent(tx, {
          ...auditContext,
          userId,
          businessId: redemption.businessId,
          eventType: 'OWNER_REGISTERED',
          responseStatus: 201,
          metadata: { isOwner: true },
        });

        const [initialTerminal] = await tx
          .select({
            terminalId: terminals.id,
            branchId: terminals.branchId,
          })
          .from(terminals)
          .where(
            and(
              eq(terminals.businessId, redemption.businessId),
              eq(terminals.status, 'active'),
            ),
          )
          .limit(1);
        if (!initialTerminal) {
          throw new ConflictException(
            'Business is missing its initial active terminal',
          );
        }

        return {
          message: 'Owner account registered and business activated.',
          userId,
          businessId: redemption.businessId,
          isOwner: true,
          roleId: null,
          branchId: null,
          initialTerminalId: initialTerminal.terminalId,
          initialBranchId: initialTerminal.branchId,
        };
      });
    } catch (error) {
      const constraint = postgresConstraintName(error);
      if (constraint === 'business_memberships_user_business_uq') {
        throw new ConflictException(
          'User already has a membership in this business',
        );
      }
      if (constraint === 'users_email_uq') {
        throw new ConflictException(
          'An account with this email was created concurrently',
        );
      }
      throw error;
    }
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
    auditContext: AuditRequestContext = {},
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

    let session: UserRefreshSession;
    try {
      session = await this.db.transaction(async (tx) => {
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
        if (!terminal || !membership) {
          throw new UnauthorizedException(
            'Terminal is not active for an assigned business branch',
          );
        }

        const effectivePermissions = membership.roleId
          ? await this.getEffectivePermissions(
              tx,
              membership.businessId!,
              membership.roleId,
              this.readPermissions(membership.permissions),
            )
          : [];
        if (membership.roleId) {
          await this.permissionsCache.set(
            membership.businessId!,
            membership.roleId,
            {
              permissions: effectivePermissions,
              roleVersion: membership.roleVersion ?? null,
            },
          );
        }

        await tx.execute(sql`
        SELECT
          set_config('app.is_platform_user', 'false', true),
          set_config('app.user_id', ${user.userId}, true),
          set_config('app.business_id', ${membership.businessId!}, true),
          set_config('app.branch_id', ${terminal.branchId}, true)
      `);
        await this.auditLogs.insertUserEvent(tx, {
          ...auditContext,
          userId: user.userId,
          businessId: membership.businessId,
          terminalId: requestedTerminalId,
          eventType: 'USER_TOKEN_REFRESHED',
          responseStatus: 200,
        });

        const accessToken = await this.jwtService.signAsync(
          {
            sub: user.userId,
            name: user.name,
            isPlatform: false,
            businessId: membership.businessId,
            branchId: terminal.branchId,
            isOwner: membership.isOwner,
            ...(membership.roleId
              ? {
                  role_id: membership.roleId,
                  role_version: membership.roleVersion ?? undefined,
                }
              : {}),
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
    } catch (error) {
      await this.auditLogs.logUserEvent(
        { userId },
        {
          ...auditContext,
          userId,
          terminalId: requestedTerminalId,
          eventType: 'USER_TOKEN_REFRESH_FAILED',
          responseStatus: error instanceof UnauthorizedException ? 401 : 500,
        },
      );
      throw error;
    }

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

function postgresConstraintName(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('cause' in error)) {
    return undefined;
  }
  const cause = error.cause;
  if (typeof cause !== 'object' || cause === null || !('constraint' in cause)) {
    return undefined;
  }
  return typeof cause.constraint === 'string' ? cause.constraint : undefined;
}
