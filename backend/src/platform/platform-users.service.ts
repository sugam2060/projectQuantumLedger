import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { appConfig } from '../config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { invitations, mailOutbox, platformUsers } from '../database/schemas';
import { RedisService } from '../redis/redis.service';
import { MailOutboxPublisher } from './mail-outbox.publisher';
import type { InvitePlatformUserDto } from './dto/invite-platform-user.dto';

const INVITE_OPERATION = 'platform.users.invite';
const IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 60 * 60;
const IDEMPOTENCY_LOCK_TTL_SECONDS = 5 * 60;
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface InviteResponse {
  message: string;
}

@Injectable()
export class PlatformUsersService {
  private readonly logger = new Logger(PlatformUsersService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly redis: RedisService,
    @Inject(appConfig.KEY)
    private readonly config: ConfigType<typeof appConfig>,
    private readonly outboxPublisher: MailOutboxPublisher,
  ) {}

  async invitePlatformUser(
    input: InvitePlatformUserDto,
    idempotencyKey: string,
    platformUserId: string,
    inviterName?: string,
  ): Promise<InviteResponse> {
    const name = input.name.trim();
    const email = input.email.trim().toLowerCase();
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ email, name }))
      .digest('hex');
    const idempotencyKeyHash = createHash('sha256')
      .update(idempotencyKey)
      .digest('hex');
    const redisKey = `idempotency:${platformUserId}:${INVITE_OPERATION}:${idempotencyKeyHash}`;
    const completedEntry = await this.readIdempotency(redisKey, requestHash);
    if (completedEntry) return completedEntry;

    const reservation = JSON.stringify({
      state: 'pending',
      requestHash,
      owner: randomUUID(),
    });
    let reserved: boolean;
    try {
      reserved = await this.redis.setIfAbsent(
        `${redisKey}:lock`,
        reservation,
        IDEMPOTENCY_LOCK_TTL_SECONDS,
      );
    } catch {
      throw new ServiceUnavailableException(
        'Idempotency service is unavailable',
      );
    }
    if (!reserved) {
      const replay = await this.readIdempotency(redisKey, requestHash);
      if (replay) return replay;
      throw new ConflictException(
        'A request with this Idempotency-Key is in progress',
      );
    }

    try {
      const response = await this.createInvitation(
        name,
        email,
        platformUserId,
        inviterName,
      );
      try {
        await this.redis.set(
          `${redisKey}:result`,
          JSON.stringify({ requestHash, response }),
          IDEMPOTENCY_TTL_SECONDS,
        );
      } catch {
        this.logger.warn(
          'Invitation committed but Redis idempotency result could not be cached',
        );
      }
      return response;
    } finally {
      try {
        await this.redis.compareAndDelete(`${redisKey}:lock`, reservation);
      } catch {
        this.logger.warn('Could not release invitation idempotency lock');
      }
    }
  }

  private async createInvitation(
    name: string,
    email: string,
    platformUserId: string,
    inviterName?: string,
  ): Promise<InviteResponse> {
    const frontendBaseUrl = this.getFrontendBaseUrl();
    const now = new Date();
    const tokenHash = createHash('sha256')
      .update(randomBytes(32))
      .digest('hex');
    const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
    const invitationUrl = `${frontendBaseUrl}/accept/invite/${tokenHash}`;

    try {
      await this.database.transactionWithSession(
        {
          isPlatform: true,
          platformUserId,
          platformAuthEmail: email,
        },
        async (tx) => {
          const [existingPlatformUser] = await tx
            .select({ id: platformUsers.id })
            .from(platformUsers)
            .where(eq(platformUsers.emailNormalized, email))
            .limit(1);
          if (existingPlatformUser) {
            throw new ConflictException(
              'A platform user with this email already exists',
            );
          }

          await tx.insert(invitations).values({
            emailNormalized: email,
            inviteeName: name,
            invitationType: 'platform_user',
            tokenHash,
            expiresAt,
            invitedByPlatformUserId: platformUserId,
          });
          await tx.insert(mailOutbox).values({
            businessId: null,
            requestId: null,
            payload: {
              id: randomUUID(),
              to: email,
              subject: 'You are invited to manage Fortis',
              template: 'user-invitation',
              context: {
                inviterName: inviterName?.trim() || 'A platform manager',
                invitationUrl,
              },
              correlationId: tokenHash,
              createdAt: now.toISOString(),
            },
          });
        },
      );
      this.outboxPublisher.notifyOutboxAvailable();
    } catch (error) {
      if (postgresErrorCode(error) === '23505') {
        throw new ConflictException(
          'A platform user or open invitation with this email already exists',
        );
      }
      throw error;
    }

    return { message: `Invite sent to ${name}` };
  }

  private getFrontendBaseUrl(): string {
    const value = this.config.frontendBaseUrl?.trim();
    if (!value) {
      throw new ServiceUnavailableException(
        'The frontend base URL is not configured correctly',
      );
    }
    try {
      const url = new URL(value);
      if (
        (url.protocol !== 'https:' && url.protocol !== 'http:') ||
        url.search ||
        url.hash
      ) {
        throw new Error();
      }
    } catch {
      throw new ServiceUnavailableException(
        'The frontend base URL is not configured correctly',
      );
    }
    return value.replace(/\/+$/, '');
  }

  private async readIdempotency(
    redisKey: string,
    requestHash: string,
  ): Promise<InviteResponse | null> {
    let value: string | null;
    try {
      value = await this.redis.get(`${redisKey}:result`);
    } catch {
      throw new ServiceUnavailableException(
        'Idempotency service is unavailable',
      );
    }
    if (!value) return null;
    const entry = JSON.parse(value) as {
      requestHash: string;
      response: InviteResponse;
    };
    if (entry.requestHash !== requestHash) {
      throw new ConflictException(
        'Idempotency-Key was already used with a different request',
      );
    }
    return entry.response;
  }
}

function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  if ('code' in error && typeof error.code === 'string') return error.code;
  if (
    'cause' in error &&
    typeof error.cause === 'object' &&
    error.cause !== null &&
    'code' in error.cause &&
    typeof error.cause.code === 'string'
  ) {
    return error.cause.code;
  }
  return undefined;
}
