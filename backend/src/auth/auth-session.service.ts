import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { REFRESH_TOKEN_TTL_SECONDS } from './auth.constants';
import type { ClientType } from './pipes/client-type.pipe';

export interface AuthSessionRecord {
  userId: string;
  clientType: ClientType;
  refreshTokenHash: string;
  deviceLabel?: string;
}

const ROTATE_REFRESH_SECRET_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if not value then
  return 0
end
local session = cjson.decode(value)
if session.refreshTokenHash ~= ARGV[1] then
  return 0
end
session.refreshTokenHash = ARGV[2]
redis.call('SET', KEYS[1], cjson.encode(session), 'EX', ARGV[3])
return 1
`;

@Injectable()
export class AuthSessionService {
  constructor(private readonly redisService: RedisService) {}

  async create(sessionId: string, session: AuthSessionRecord): Promise<void> {
    const result = await this.redisService.client.set(
      this.sessionKey(sessionId),
      JSON.stringify(session),
      'EX',
      REFRESH_TOKEN_TTL_SECONDS,
      'NX',
    );

    if (result !== 'OK') {
      throw new InternalServerErrorException(
        'Unable to create authentication session',
      );
    }
  }

  async get(sessionId: string): Promise<AuthSessionRecord | null> {
    const serialized = await this.redisService.client.get(
      this.sessionKey(sessionId),
    );

    if (serialized === null) {
      return null;
    }

    let value: unknown;
    try {
      value = JSON.parse(serialized);
    } catch {
      throw new InternalServerErrorException(
        'Invalid authentication session state',
      );
    }

    if (!isAuthSessionRecord(value)) {
      throw new InternalServerErrorException(
        'Invalid authentication session state',
      );
    }

    return value;
  }

  async rotate(
    sessionId: string,
    currentRefreshTokenHash: string,
    nextRefreshTokenHash: string,
  ): Promise<boolean> {
    const result = await this.redisService.client.eval(
      ROTATE_REFRESH_SECRET_SCRIPT,
      1,
      this.sessionKey(sessionId),
      currentRefreshTokenHash,
      nextRefreshTokenHash,
      REFRESH_TOKEN_TTL_SECONDS,
    );

    if (typeof result !== 'number') {
      throw new InternalServerErrorException(
        'Unable to rotate authentication session',
      );
    }

    return result === 1;
  }

  async isActive(sessionId: string): Promise<boolean> {
    return (
      (await this.redisService.client.exists(this.sessionKey(sessionId))) === 1
    );
  }

  async revoke(sessionId: string): Promise<void> {
    await this.redisService.client.del(this.sessionKey(sessionId));
  }

  private sessionKey(sessionId: string): string {
    return `auth:session:${sessionId}`;
  }
}

function isAuthSessionRecord(value: unknown): value is AuthSessionRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  if (
    !('userId' in value) ||
    !('clientType' in value) ||
    !('refreshTokenHash' in value) ||
    typeof value.userId !== 'string' ||
    typeof value.refreshTokenHash !== 'string' ||
    (value.clientType !== 'desktop' &&
      value.clientType !== 'web' &&
      value.clientType !== 'mobile')
  ) {
    return false;
  }

  return (
    !('deviceLabel' in value) ||
    value.deviceLabel === undefined ||
    typeof value.deviceLabel === 'string'
  );
}
