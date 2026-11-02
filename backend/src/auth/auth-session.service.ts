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
local sessionId = string.sub(KEYS[1], 14)
local userSessionsKey = 'auth:user-sessions:' .. session.userId
redis.call('SADD', userSessionsKey, sessionId)
redis.call('EXPIRE', userSessionsKey, ARGV[3])
return 1
`;

const CREATE_SESSION_SCRIPT = `
local result = redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3], 'NX')
if not result then
  return 0
end
redis.call('SADD', KEYS[2], ARGV[2])
redis.call('EXPIRE', KEYS[2], ARGV[3])
return 1
`;

const REVOKE_SESSION_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if value then
  local session = cjson.decode(value)
  redis.call('SREM', 'auth:user-sessions:' .. session.userId, ARGV[1])
end
return redis.call('DEL', KEYS[1])
`;

const REVOKE_USER_SESSIONS_SCRIPT = `
local sessionIds = redis.call('SMEMBERS', KEYS[1])
for _, sessionId in ipairs(sessionIds) do
  redis.call('DEL', 'auth:session:' .. sessionId)
end
redis.call('DEL', KEYS[1])
return #sessionIds
`;

const SESSION_KEY_PREFIX = 'auth:session:';

@Injectable()
export class AuthSessionService {
  constructor(private readonly redisService: RedisService) {}

  async create(sessionId: string, session: AuthSessionRecord): Promise<void> {
    const result = await this.redisService.client.eval(
      CREATE_SESSION_SCRIPT,
      2,
      this.sessionKey(sessionId),
      this.userSessionsKey(session.userId),
      JSON.stringify(session),
      sessionId,
      REFRESH_TOKEN_TTL_SECONDS,
    );

    if (result !== 1) {
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
    await this.redisService.client.eval(
      REVOKE_SESSION_SCRIPT,
      1,
      this.sessionKey(sessionId),
      sessionId,
    );
  }

  async revokeAll(userId: string): Promise<void> {
    await this.indexExistingUserSessions(userId);

    const result = await this.redisService.client.eval(
      REVOKE_USER_SESSIONS_SCRIPT,
      1,
      this.userSessionsKey(userId),
    );

    if (typeof result !== 'number' || result < 0) {
      throw new InternalServerErrorException(
        'Unable to revoke authentication sessions',
      );
    }
  }

  private async indexExistingUserSessions(userId: string): Promise<void> {
    const userSessionsKey = this.userSessionsKey(userId);
    let cursor = '0';

    do {
      const [nextCursor, sessionKeys] = await this.redisService.client.scan(
        cursor,
        'MATCH',
        `${SESSION_KEY_PREFIX}*`,
        'COUNT',
        100,
      );
      cursor = nextCursor;

      for (let offset = 0; offset < sessionKeys.length; offset += 100) {
        const keyBatch = sessionKeys.slice(offset, offset + 100);
        const values = await this.redisService.client.mget(...keyBatch);
        const matchingSessionIds: string[] = [];

        values.forEach((serialized, index) => {
          if (serialized === null) {
            return;
          }

          let session: unknown;
          try {
            session = JSON.parse(serialized);
          } catch {
            throw new InternalServerErrorException(
              'Invalid authentication session state',
            );
          }

          if (
            typeof session === 'object' &&
            session !== null &&
            'userId' in session &&
            session.userId === userId
          ) {
            matchingSessionIds.push(
              keyBatch[index].slice(SESSION_KEY_PREFIX.length),
            );
          }
        });

        if (matchingSessionIds.length > 0) {
          await this.redisService.client.sadd(
            userSessionsKey,
            ...matchingSessionIds,
          );
        }
      }
    } while (cursor !== '0');
  }

  private sessionKey(sessionId: string): string {
    return `${SESSION_KEY_PREFIX}${sessionId}`;
  }

  private userSessionsKey(userId: string): string {
    return `auth:user-sessions:${userId}`;
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
