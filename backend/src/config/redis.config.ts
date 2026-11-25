import { registerAs } from '@nestjs/config';
import { readRequiredString } from './env.util';
import type { RedisConfig } from './types';

/** Redis connection settings. */
export const redisConfig = registerAs('redis', (): RedisConfig => ({
  url: readRequiredString('REDIS_URL'),
}));
