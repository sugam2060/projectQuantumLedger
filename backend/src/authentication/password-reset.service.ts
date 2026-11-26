import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { AuditLogsService, type AuditRequestContext } from '../audit-logs';
import {
  generateOpaqueToken,
  hashOpaqueToken,
} from '../common/utils/opaque-token.util';
import { appConfig, authConfig } from '../config';
import { EmailProducer } from '../jobs/email';
import { PasswordService } from './password.service';
import {
  PasswordsRepository,
  type PasswordActorKind,
} from './passwords.repository';

const INVALID_RESET = 'Invalid or expired reset token';

/** Where each kind of account resets its password on the website. */
const RESET_PATHS: Record<PasswordActorKind, string> = {
  user: '/reset-password',
  platform: '/platform/reset-password',
};

/**
 * Forgot-password and reset-password for business users and platform users.
 * Forgot never reveals whether an email exists; reset is single-use, sets the
 * new password and signs the account out everywhere.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly repository: PasswordsRepository,
    private readonly passwords: PasswordService,
    private readonly email: EmailProducer,
    private readonly auditLogs: AuditLogsService,
    @Inject(authConfig.KEY)
    private readonly auth: ConfigType<typeof authConfig>,
    @Inject(appConfig.KEY)
    private readonly app: ConfigType<typeof appConfig>,
  ) {}

  /**
   * Starts `requestReset` without waiting for it, so the HTTP response takes the
   * same time whether or not the email belongs to an account.
   */
  requestResetInBackground(actor: PasswordActorKind, email: string): void {
    this.requestReset(actor, email).catch((error: unknown) => {
      this.logger.error(
        `Password reset request failed for a ${actor} account`,
        error instanceof Error ? error.stack : undefined,
      );
    });
  }

  /**
   * Emails a reset link when an active account has this email. Same outcome (and
   * no error) when it does not; enqueue failures are logged, not returned.
   */
  async requestReset(actor: PasswordActorKind, email: string): Promise<void> {
    const token = generateOpaqueToken();
    const ttlMinutes = this.auth.passwordResetTtlMinutes;
    const account = await this.repository.createResetToken({
      actor,
      email,
      tokenHash: hashOpaqueToken(token),
      expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
    });
    if (!account) return;

    const frontend = this.app.frontendBaseUrl?.replace(/\/+$/, '');
    if (!frontend) {
      this.logger.error(
        'FRONTEND_BASE_URL is not set; password reset email was not sent',
      );
      return;
    }
    const resetUrl = `${frontend}${RESET_PATHS[actor]}?token=${encodeURIComponent(token)}`;
    try {
      await this.email.send({
        id: randomUUID(),
        to: account.email,
        subject: 'Reset your Fortis password',
        template: 'password-reset',
        context: {
          name: account.name,
          resetUrl,
          expiresInMinutes: ttlMinutes,
        },
        correlationId: account.id,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error(
        `Could not enqueue the password reset email for ${actor} ${account.id}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /** Consumes the token, stores the new password and revokes every session. */
  async reset(
    actor: PasswordActorKind,
    token: string,
    newPassword: string,
    audit: AuditRequestContext = {},
  ): Promise<void> {
    const accountId = await this.repository.consumeResetToken({
      actor,
      tokenHash: hashOpaqueToken(token),
      passwordHash: await this.passwords.hash(newPassword),
    });
    if (!accountId) throw new BadRequestException(INVALID_RESET);

    if (actor === 'user') {
      await this.auditLogs.logUserEvent(
        { userId: accountId },
        { ...audit, userId: accountId, eventType: 'USER_PASSWORD_RESET' },
      );
    } else {
      await this.auditLogs.logPlatformEvent({
        ...audit,
        platformUserId: accountId,
        action: 'platform.password.reset',
        responseStatus: 204,
      });
    }
  }
}
