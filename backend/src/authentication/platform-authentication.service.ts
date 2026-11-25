import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { AuditLogsService } from '../audit-logs';
import type { AuthenticatedUser } from '../common/types';
import {
  generateOpaqueToken,
  hashOpaqueToken,
  isOpaqueTokenShape,
} from '../common/utils/opaque-token.util';
import { authConfig } from '../config';
import type { PlatformUserLoginDto } from './dto/platform-user-login.dto';
import { PasswordService } from './password.service';
import { PlatformAuthenticationRepository } from './platform-authentication.repository';
import { SessionsRepository } from './sessions.repository';
import { TokenService } from './token.service';
import type {
  AuthMetadata,
  PlatformAccount,
  PlatformAuthResult,
} from './types';

const INVALID_CREDENTIALS = 'Invalid email or password';
const INVALID_REFRESH = 'Invalid refresh token';

/**
 * Platform-user (Fortis staff) authentication. Same session model as business
 * users (Postgres sessions, rotation, reuse detection) with platform-audience
 * access tokens.
 */
@Injectable()
export class PlatformAuthenticationService {
  private readonly logger = new Logger(PlatformAuthenticationService.name);

  constructor(
    private readonly repository: PlatformAuthenticationRepository,
    private readonly sessions: SessionsRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly auditLogs: AuditLogsService,
    @Inject(authConfig.KEY)
    private readonly config: ConfigType<typeof authConfig>,
  ) {}

  async login(
    dto: PlatformUserLoginDto,
    meta: AuthMetadata,
  ): Promise<PlatformAuthResult> {
    const email = dto.email.trim().toLowerCase();
    const credential = await this.repository.findCredentialByEmail(email);
    if (!credential) {
      await this.passwords.verifyAgainstDummy(dto.password);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const check = await this.passwords.verify(
      credential.passwordHash,
      dto.password,
    );
    if (!check.valid || credential.status !== 'active') {
      await this.audit(credential.id, meta, 'platform.login.failed', 401, {
        reason: check.valid ? 'inactive_account' : 'invalid_credentials',
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    if (check.needsRehash) {
      await this.rehash(credential.id, dto.password);
    }

    const refreshToken = generateOpaqueToken();
    await this.sessions.create(
      { platformUserId: credential.id },
      {
        tokenHash: hashOpaqueToken(refreshToken),
        clientType: meta.clientType,
        terminalId: null,
        persistent: true,
        userAgent: meta.userAgent ?? null,
        ip: meta.ip ?? null,
        expiresAt: new Date(Date.now() + this.refreshTtlMs()),
      },
    );
    const result = await this.issue(credential, refreshToken);
    await this.audit(credential.id, meta, 'platform.login.succeeded', 200);
    return result;
  }

  async refresh(
    refreshToken: string | undefined,
    meta: AuthMetadata,
  ): Promise<PlatformAuthResult> {
    if (!isOpaqueTokenShape(refreshToken)) {
      throw new UnauthorizedException(INVALID_REFRESH);
    }
    const nextToken = generateOpaqueToken();
    const nextHash = hashOpaqueToken(nextToken);
    const rotation = await this.sessions.rotate({
      oldHash: hashOpaqueToken(refreshToken),
      newHash: nextHash,
      userAgent: meta.userAgent ?? null,
      ip: meta.ip ?? null,
      persistentTtlSeconds: this.config.refreshPersistentTtlSeconds,
      sessionTtlSeconds: this.config.refreshSessionTtlSeconds,
    });

    if (rotation.outcome === 'reuse' && rotation.platformUserId) {
      await this.audit(
        rotation.platformUserId,
        meta,
        'platform.token.reuse_detected',
        401,
      );
    }
    if (rotation.outcome !== 'rotated' || !rotation.platformUserId) {
      if (rotation.outcome === 'rotated') await this.sessions.revoke(nextHash);
      throw new UnauthorizedException(INVALID_REFRESH);
    }

    const account = await this.repository.findAccount(rotation.platformUserId);
    if (!account || account.status !== 'active') {
      await this.sessions.revoke(nextHash);
      await this.audit(
        rotation.platformUserId,
        meta,
        'platform.token.refresh_failed',
        401,
        { reason: 'inactive_account' },
      );
      throw new UnauthorizedException(INVALID_REFRESH);
    }

    const result = await this.issue(account, nextToken);
    await this.audit(account.id, meta, 'platform.token.refreshed', 200);
    return result;
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!isOpaqueTokenShape(refreshToken)) return;
    await this.sessions.revoke(hashOpaqueToken(refreshToken));
  }

  async logoutAll(user: AuthenticatedUser): Promise<{ revoked: number }> {
    if (!user.platformUserId) throw new UnauthorizedException();
    const revoked = await this.sessions.revokeAll({
      platformUserId: user.platformUserId,
    });
    return { revoked };
  }

  private async issue(
    account: Pick<PlatformAccount, 'id' | 'email' | 'name' | 'isBootstrap'>,
    refreshToken: string,
  ): Promise<PlatformAuthResult> {
    const access = await this.tokens.signPlatformToken({
      sub: account.id,
      platformUserId: account.id,
      email: account.email,
      isPlatform: true,
      isBootstrap: account.isBootstrap,
    });
    return {
      accessToken: access.token,
      refreshToken,
      refreshMaxAgeMs: this.refreshTtlMs(),
      tokenType: 'Bearer',
      expiresIn: access.expiresInSeconds,
      user: { id: account.id, displayName: account.name },
      isPlatform: true,
      isBootstrap: account.isBootstrap,
    };
  }

  /** Staff sessions always use the long lifetime (the website remembers them). */
  private refreshTtlMs(): number {
    return this.config.refreshPersistentTtlSeconds * 1000;
  }

  private async rehash(
    platformUserId: string,
    password: string,
  ): Promise<void> {
    try {
      await this.repository.updatePasswordHash(
        platformUserId,
        await this.passwords.hash(password),
      );
    } catch (error) {
      this.logger.warn(
        `Could not upgrade the password hash of platform user ${platformUserId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private audit(
    platformUserId: string,
    meta: AuthMetadata,
    action: string,
    responseStatus: number,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    return this.auditLogs.logPlatformEvent({
      ...meta.audit,
      platformUserId,
      action,
      responseStatus,
      ...(metadata ? { metadata } : {}),
    });
  }
}
