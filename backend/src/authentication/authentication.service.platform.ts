import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { DatabaseService } from '../database/database.service';
import { platformUsers } from '../database/schema';
import { RedisService } from '../redis/redis.service';
import { UtilsService } from '../utils/utils.service';
import { PlatformUserLoginDto } from './dto/platform-user-login.dto';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const REFRESH_TOKEN_PREFIX = 'platform_refresh_token:';

interface PlatformUserIdentity {
  id: string;
  name: string;
  isBootstrap: boolean;
}

export interface PlatformAuthResult {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: { id: string; displayName: string };
  isPlatform: true;
  isBootstrap: boolean;
}

@Injectable()
export class PlatformAuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly utilsService: UtilsService,
    private readonly redisService: RedisService,
  ) {}

  async login(dto: PlatformUserLoginDto): Promise<PlatformAuthResult> {
    if (typeof dto.email !== 'string' || !dto.email.trim()) {
      throw new BadRequestException('Valid email is required');
    }
    if (typeof dto.password !== 'string' || !dto.password) {
      throw new BadRequestException('Valid password is required');
    }

    const email = dto.email.trim().toLowerCase();
    const [credential] = await this.database.transactionWithSession(
      { platformAuthEmail: email },
      (transaction) =>
        transaction
          .select({
            id: platformUsers.id,
            passwordHash: platformUsers.passwordHash,
            name: platformUsers.name,
            status: platformUsers.status,
            isBootstrap: platformUsers.isBootstrap,
          })
          .from(platformUsers)
          .where(eq(platformUsers.emailNormalized, email))
          .limit(1),
    );
    if (
      !credential ||
      credential.status !== 'active' ||
      !(await bcrypt.compare(dto.password, credential.passwordHash))
    ) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.createSession({
      id: credential.id,
      name: credential.name,
      isBootstrap: credential.isBootstrap,
    });
  }

  async refresh(refreshToken: string): Promise<PlatformAuthResult> {
    if (!refreshToken?.trim()) {
      throw new UnauthorizedException('Refresh token is required');
    }

    const oldKey = `${REFRESH_TOKEN_PREFIX}${refreshToken}`;
    const platformUserId = await this.redisService.get(oldKey);
    if (!platformUserId) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const [platformUser] = await this.database.transactionWithSession(
      { isPlatform: true, platformUserId },
      async (transaction) =>
        transaction
          .select({
            id: platformUsers.id,
            name: platformUsers.name,
            status: platformUsers.status,
            isBootstrap: platformUsers.isBootstrap,
          })
          .from(platformUsers)
          .where(eq(platformUsers.id, platformUserId))
          .limit(1),
    );

    if (!platformUser || platformUser.status !== 'active') {
      await this.redisService.delete(oldKey);
      throw new UnauthorizedException('Platform user is not active');
    }

    const session = await this.createSession({
      id: platformUser.id,
      name: platformUser.name,
      isBootstrap: platformUser.isBootstrap,
    });
    await this.redisService.delete(oldKey);
    return session;
  }

  async invalidateRefreshToken(refreshToken: string): Promise<void> {
    await this.redisService.delete(`${REFRESH_TOKEN_PREFIX}${refreshToken}`);
  }

  private async createSession(
    user: PlatformUserIdentity,
  ): Promise<PlatformAuthResult> {
    const accessToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        platformUserId: user.id,
        isPlatform: true,
        isBootstrap: user.isBootstrap,
      },
      { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
    );
    const refreshToken = this.utilsService.generateRefreshToken();
    await this.redisService.set(
      `${REFRESH_TOKEN_PREFIX}${refreshToken}`,
      user.id,
      REFRESH_TOKEN_TTL_SECONDS,
    );

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      user: { id: user.id, displayName: user.name },
      isPlatform: true,
      isBootstrap: user.isBootstrap,
    };
  }
}
