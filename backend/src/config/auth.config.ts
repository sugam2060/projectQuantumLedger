import { registerAs } from '@nestjs/config';
import { parseDurationSeconds } from './duration';
import { readInt, readString } from './env.util';
import type { AuthConfig } from './types';

const DEFAULT_ACCESS_TTL = '15m';

/** Token signing and session lifetime settings. */
export const authConfig = registerAs('auth', (): AuthConfig => {
  // JWT_SECRET is the old name; JWT_ACCESS_SECRET wins when both are set.
  const jwtSecret = readString('JWT_ACCESS_SECRET') ?? readString('JWT_SECRET');
  if (!jwtSecret) throw new Error('JWT_ACCESS_SECRET is required');
  const accessTtl = readString('JWT_ACCESS_TTL') ?? DEFAULT_ACCESS_TTL;
  return {
    jwtSecret,
    accessTtl,
    accessTtlSeconds: parseDurationSeconds(accessTtl),
    issuer: readString('JWT_ISSUER') ?? 'fortis-api',
    audience: readString('JWT_AUDIENCE') ?? 'fortis-pos',
    platformAudience: readString('JWT_PLATFORM_AUDIENCE') ?? 'fortis-platform',
    refreshPersistentTtlSeconds: readInt('REFRESH_TOKEN_TTL_DAYS', 30) * 86_400,
    refreshSessionTtlSeconds:
      readInt('REFRESH_TOKEN_SESSION_TTL_HOURS', 12) * 3600,
  };
});
