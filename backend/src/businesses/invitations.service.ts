import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  generateOpaqueToken,
  hashOpaqueToken,
} from '../common/utils/opaque-token.util';
import { appConfig } from '../config';
import { EmailProducer } from '../jobs/email';
import type { CreateInvitationsDto } from './dto';
import { InvitationsRepository } from './invitations.repository';
import type { InvitationResultStatus, InvitationView } from './types';
import { assertOk } from './utils/outcome.util';

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Business-side invitations: invite (up to 20 addresses), list, resend, revoke.
 * Only the token hash is stored; the raw token travels in the email link.
 */
@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly repository: InvitationsRepository,
    private readonly email: EmailProducer,
    @Inject(appConfig.KEY)
    private readonly app: ConfigType<typeof appConfig>,
  ) {}

  async invite(
    inviter: { userId: string; name?: string },
    businessId: string,
    dto: CreateInvitationsDto,
    scopeBranchId?: string,
  ): Promise<{ results: { email: string; status: InvitationResultStatus }[] }> {
    if (
      scopeBranchId &&
      dto.branchId !== undefined &&
      dto.branchId.toLowerCase() !== scopeBranchId
    ) {
      throw new BadRequestException('branchId must match the branch route');
    }
    const frontend = this.frontendBaseUrl();
    const tokens = dto.emails.map((email) => ({
      email,
      token: generateOpaqueToken(),
    }));
    const outcomes = await this.repository.create(
      inviter.userId,
      businessId,
      scopeBranchId,
      {
        invitations: tokens.map(({ email, token }) => ({
          email,
          tokenHash: hashOpaqueToken(token),
        })),
        roleId: dto.roleId,
        branchId: scopeBranchId ?? dto.branchId ?? null,
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      },
    );

    const results = tokens.map(({ email, token }, index) => ({
      email,
      status: outcomes[index],
      token,
    }));
    for (const result of results) {
      if (result.status === 'invited') {
        await this.sendInvitation(
          frontend,
          result.email,
          result.token,
          inviter,
        );
      }
    }
    return {
      results: results.map(({ email, status }) => ({ email, status })),
    };
  }

  list(
    userId: string,
    businessId: string,
    scopeBranchId?: string,
  ): Promise<InvitationView[]> {
    return this.repository.list(userId, businessId, scopeBranchId);
  }

  async resend(
    inviter: { userId: string; name?: string },
    businessId: string,
    invitationId: string,
    scopeBranchId?: string,
  ): Promise<{ message: string }> {
    const frontend = this.frontendBaseUrl();
    const token = generateOpaqueToken();
    const { outcome, email } = await this.repository.reissue(
      inviter.userId,
      businessId,
      scopeBranchId,
      invitationId,
      hashOpaqueToken(token),
      new Date(Date.now() + INVITATION_TTL_MS),
    );
    assertOk(outcome, { not_found: 'Open invitation was not found' });
    await this.sendInvitation(frontend, email as string, token, inviter);
    return { message: 'Invitation sent again' };
  }

  async revoke(
    userId: string,
    businessId: string,
    invitationId: string,
    scopeBranchId?: string,
  ): Promise<void> {
    assertOk(
      await this.repository.revoke(
        userId,
        businessId,
        scopeBranchId,
        invitationId,
      ),
      { not_found: 'Open invitation was not found' },
    );
  }

  /** Enqueue failures are logged: the invitation exists and can be resent. */
  private async sendInvitation(
    frontend: string,
    email: string,
    token: string,
    inviter: { userId: string; name?: string },
  ): Promise<void> {
    try {
      await this.email.send({
        id: randomUUID(),
        to: email,
        subject: 'You are invited to join a business on Fortis',
        template: 'user-invitation',
        context: {
          inviterName: inviter.name?.trim() || 'A Fortis user',
          invitationUrl: `${frontend}/invitations/accept?token=${encodeURIComponent(token)}`,
        },
        correlationId: inviter.userId,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error(
        'Invitation saved but its email could not be enqueued',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private frontendBaseUrl(): string {
    const value = this.app.frontendBaseUrl?.trim().replace(/\/+$/, '');
    if (!value) {
      throw new ServiceUnavailableException(
        'The frontend base URL is not configured',
      );
    }
    return value;
  }
}
