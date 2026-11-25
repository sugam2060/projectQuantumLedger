import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { RedisService } from '../redis/redis.service';
import type {
  BusinessIdempotencyContext,
  BusinessIdempotencyFile,
  BusinessIdempotencyState,
  BusinessUpdateFields,
  BusinessUpdateResponse,
} from './types';

const OPERATION = 'businesses.update';
const RESULT_TTL_SECONDS = 7 * 24 * 60 * 60;
const LOCK_TTL_SECONDS = 5 * 60;

/**
 * Redis-backed idempotency for `PATCH /businesses/:businessId`. `begin` either
 * returns a stored response (replay) or reserves the key; the caller then calls
 * `complete` after commit and always `release`.
 */
@Injectable()
export class BusinessUpdateIdempotencyService {
  private readonly logger = new Logger(BusinessUpdateIdempotencyService.name);

  constructor(private readonly redis: RedisService) {}

  async begin(
    userId: string,
    businessId: string,
    idempotencyKey: string,
    fields: BusinessUpdateFields,
    reason: string,
    files: BusinessIdempotencyFile[],
  ): Promise<BusinessIdempotencyState> {
    const fileHashes = files.map(
      ({ path, originalName, mimeType, content }) => ({
        path,
        originalName,
        mimeType,
        contentHash: createHash('sha256').update(content).digest('hex'),
      }),
    );
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ fields, reason, files: fileHashes }))
      .digest('hex');
    const keyHash = createHash('sha256').update(idempotencyKey).digest('hex');
    const redisKey = `idempotency:${userId}:${OPERATION}:${businessId}:${keyHash}`;

    const cached = await this.readResult(redisKey, requestHash);
    if (cached) return { kind: 'replay', response: cached };

    const reservation = JSON.stringify({ requestHash, owner: randomUUID() });
    let reserved: boolean;
    try {
      reserved = await this.redis.setIfAbsent(
        `${redisKey}:lock`,
        reservation,
        LOCK_TTL_SECONDS,
      );
    } catch {
      throw new ServiceUnavailableException(
        'Idempotency service is unavailable',
      );
    }
    if (!reserved) {
      const replay = await this.readResult(redisKey, requestHash);
      if (replay) return { kind: 'replay', response: replay };
      throw new ConflictException(
        'A request with this Idempotency-Key is in progress',
      );
    }

    return { kind: 'reserved', redisKey, requestHash, reservation };
  }

  async complete(
    context: BusinessIdempotencyContext,
    response: BusinessUpdateResponse,
  ): Promise<void> {
    try {
      await this.redis.set(
        `${context.redisKey}:result`,
        JSON.stringify({ requestHash: context.requestHash, response }),
        RESULT_TTL_SECONDS,
      );
    } catch {
      this.logger.warn(
        'Business update committed but idempotency result could not be cached',
      );
    }
  }

  async release(context: BusinessIdempotencyContext): Promise<void> {
    try {
      await this.redis.compareAndDelete(
        `${context.redisKey}:lock`,
        context.reservation,
      );
    } catch {
      this.logger.warn('Could not release business update idempotency lock');
    }
  }

  private async readResult(
    redisKey: string,
    requestHash: string,
  ): Promise<BusinessUpdateResponse | null> {
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
      response: BusinessUpdateResponse;
    };
    if (entry.requestHash !== requestHash) {
      throw new ConflictException(
        'Idempotency-Key was already used with a different request',
      );
    }
    return entry.response;
  }
}
