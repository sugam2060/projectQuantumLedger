import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PASSWORD_MIN_LENGTH, PasswordService } from '../authentication';
import { hashOpaqueToken } from '../common/utils/opaque-token.util';
import type { AcceptInvitationDto } from './dto';
import { InvitationsRepository } from './invitations.repository';
import type { InvitationPreview } from './types';

const INVALID = 'Invitation is invalid or has expired';

/**
 * Public side of business invitations: preview and accept with the emailed
 * token. Acceptance is decided by app.accept_business_invitation (single use,
 * row-locked); this service verifies an existing account's password first.
 */
@Injectable()
export class MyInvitationsService {
  constructor(
    private readonly repository: InvitationsRepository,
    private readonly passwords: PasswordService,
  ) {}

  async preview(token: string): Promise<InvitationPreview> {
    const preview = await this.repository.preview(hashOpaqueToken(token));
    if (!preview) throw new NotFoundException(INVALID);
    return preview;
  }

  async accept(
    dto: AcceptInvitationDto,
  ): Promise<{ businessId: string; userId: string; accountCreated: boolean }> {
    const tokenHash = hashOpaqueToken(dto.token);
    const preview = await this.repository.preview(tokenHash);
    if (!preview) {
      await this.passwords.verifyAgainstDummy(dto.password);
      throw new BadRequestException(INVALID);
    }

    let userId: string | null = null;
    let passwordHash: string | null = null;
    if (preview.accountExists) {
      const credential = await this.repository.findCredential(preview.email);
      const check = credential
        ? await this.passwords.verify(credential.passwordHash, dto.password)
        : { valid: await this.passwords.verifyAgainstDummy(dto.password) };
      if (!credential || !check.valid || credential.status !== 'active') {
        throw new BadRequestException(INVALID);
      }
      userId = credential.id;
    } else {
      if (!dto.name) {
        throw new BadRequestException('name is required for a new account');
      }
      if (dto.password.length < PASSWORD_MIN_LENGTH) {
        throw new BadRequestException(
          `password must be at least ${PASSWORD_MIN_LENGTH} characters`,
        );
      }
      passwordHash = await this.passwords.hash(dto.password);
    }

    const result = await this.repository.accept({
      tokenHash,
      userId,
      name: userId ? null : (dto.name ?? null),
      passwordHash,
      confirmResignation: dto.confirmResignation === true,
    });
    switch (result.outcome) {
      case 'accepted':
        return {
          businessId: result.businessId as string,
          userId: result.userId as string,
          accountCreated: userId === null,
        };
      case 'active_membership':
        throw new ConflictException(
          'You are a member of another business. Send confirmResignation: true to leave it and join this one.',
        );
      case 'owner_elsewhere':
        throw new ConflictException(
          'You own another business and cannot leave it to join this one.',
        );
      default:
        throw new BadRequestException(INVALID);
    }
  }
}
