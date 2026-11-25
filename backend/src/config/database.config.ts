import { registerAs } from '@nestjs/config';
import { readInt, readRequiredString } from './env.util';
import type { DatabaseConfig } from './types';

/** Runtime database connection and pool settings. */
export const databaseConfig = registerAs('database', (): DatabaseConfig => ({
  url: readRequiredString('DATABASE_URL'),
  pool: {
    max: readInt('DB_POOL_MAX', 10),
    min: readInt('DB_POOL_MIN', 0),
    idleTimeoutMs: readInt('DB_POOL_IDLE_TIMEOUT_MS', 30000),
    connectionTimeoutMs: readInt('DB_POOL_CONNECTION_TIMEOUT_MS', 5000),
  },
}));
