import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { businessMemberships, roles, users } from '../database/schema';
import { ClientLoginDTO, ClientType } from './dto/clientLogin.dto';
import { UtilsService } from '../utils/utils.service';
import { RedisService } from '../redis/redis.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UserAuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly utilsService: UtilsService,
    private readonly redisService: RedisService,
  ) {}

  async userLogin(dto: ClientLoginDTO) {
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
      // Login has no authenticated user context yet, so briefly enable the
      // platform read policy for the unique email lookup only.
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
          rolePermissions: roles.permissions,
        })
        .from(users)
        .leftJoin(
          businessMemberships,
          and(
            eq(users.id, businessMemberships.userId),
            eq(businessMemberships.isActive, true)
          )
        )
        .leftJoin(roles, eq(businessMemberships.roleId, roles.id))
        .where(
          and(
            eq(users.emailNormalized, email),
            eq(users.status, 'active')
          ),
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

      await tx.execute(sql`
        SELECT
          set_config('app.is_platform_user', 'false', true),
          set_config('app.user_id', ${firstRecord.userId}, true)
      `);

      // Process the joined results to separate user data from memberships
      const user = {
        id: firstRecord.userId,
        email: firstRecord.userEmail,
        name: firstRecord.userName,
      };

      // Group membership data by businessId to avoid duplicates
      const membershipMap = new Map();
      userData.forEach(record => {
        if (record.businessId) {
          const key = `${record.businessId}-${record.roleId}`;
          if (!membershipMap.has(key)) {
            membershipMap.set(key, {
              businessId: record.businessId,
              branchId: record.branchId,
              isOwner: record.isOwner,
              roleId: record.roleId,
              role: record.roleName,
              permissions: this.readPermissions(record.rolePermissions),
            });
          }
        }
      });

      const membershipsWithRoles = Array.from(membershipMap.values());

      const activeMembership = membershipsWithRoles.length === 1 ? membershipsWithRoles[0] : undefined;
      const accessToken = await this.jwtService.signAsync(
        {
          sub: user.id,
          userId: user.id,
          isPlatform: false,
          ...(activeMembership
            ? {
                businessId: activeMembership.businessId,
                branchId: activeMembership.branchId ?? undefined,
                isOwner: activeMembership.isOwner,
                role: activeMembership.role,
                permissions: activeMembership.permissions,
              }
            : { permissions: [] }),
        },
        { expiresIn },
      );

      // Generate refresh token if remember is true
      let refreshToken: string | undefined;
      if (dto.remember) {
        refreshToken = this.utilsService.generateRefreshToken();
        // Store refresh token in Redis with 7-day expiration
        await this.redisService.set(`refresh_token:${refreshToken}`, user.id, 7 * 24 * 60 * 60);
      }

      return {
        accessToken,
        ...(refreshToken && { refreshToken }),
        tokenType: 'Bearer',
        expiresIn,
        user,
        memberships: membershipsWithRoles,
      };
    });
  }

  private readPermissions(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter(
      (permission): permission is string => typeof permission === 'string',
    );
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
  async refreshAccessToken(refreshToken: string): Promise<any> {
    // Check if refresh token exists in Redis
    const userId = await this.redisService.get(`refresh_token:${refreshToken}`);
    if (!userId) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Fetch user data (similar to login but without password verification)
    // We need to temporarily enable platform user context to fetch the user by ID
    const userData = await this.db.execute(sql`
      SELECT set_config('app.is_platform_user', 'true', true)
    `);

    const [user] = await this.db.select({
      id: users.id,
      emailNormalized: users.emailNormalized,
      name: users.name,
      status: users.status,
    }).from(users).where(eq(users.id, userId)).limit(1);

    // Reset platform user context
    await this.db.execute(sql`
      SELECT set_config('app.is_platform_user', 'false', true)
    `);

    if (!user) {
      // User no longer exists, invalidate the refresh token
      await this.invalidateRefreshToken(refreshToken);
      throw new UnauthorizedException('User not found');
    }

    // Generate new access token
    const accessToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        userId: user.id,
        isPlatform: false,
        permissions: [], // TODO: Fetch actual user permissions
      },
      { expiresIn: '15m' },
    );

    // Optionally generate a new refresh token (refresh token rotation)
    // This adds an extra layer of security by rotating refresh tokens
    const newRefreshToken = this.utilsService.generateRefreshToken();
    await this.redisService.set(`refresh_token:${newRefreshToken}`, userId, 7 * 24 * 60 * 60);

    // Invalidate the old refresh token
    await this.invalidateRefreshToken(refreshToken);

    return {
      accessToken,
      refreshToken: newRefreshToken,
      tokenType: 'Bearer',
      expiresIn: '15m',
      user: {
        id: user.id,
        email: user.emailNormalized,
        name: user.name,
      },
    };
  }
}