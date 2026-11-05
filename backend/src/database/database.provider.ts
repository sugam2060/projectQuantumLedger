import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export function createDatabaseOptions(configService: ConfigService) {
  const getPoolSetting = (
    key: string,
    defaultValue: number,
    minimum: number,
  ) => {
    const value = configService.get<string>(key);
    const parsed = value === undefined ? defaultValue : Number(value);

    if (!Number.isInteger(parsed) || parsed < minimum) {
      throw new Error(
        `${key} must be an integer greater than or equal to ${minimum}`,
      );
    }

    return parsed;
  };

  const connectionString = configService.getOrThrow<string>('DATABASE_URL');
  if (!connectionString.trim()) {
    throw new Error('DATABASE_URL must not be empty');
  }

  const max = getPoolSetting('DB_POOL_MAX', 10, 1);
  const min = getPoolSetting('DB_POOL_MIN', 0, 0);
  if (min > max) {
    throw new Error('DB_POOL_MIN must not exceed DB_POOL_MAX');
  }

  const pool = new Pool({
    connectionString,
    max,
    min,
    idleTimeoutMillis: getPoolSetting('DB_POOL_IDLE_TIMEOUT_MS', 30000, 0),
    connectionTimeoutMillis: getPoolSetting(
      'DB_POOL_CONNECTION_TIMEOUT_MS',
      5000,
      0,
    ),
  });

  return {
    db: drizzle(pool, { schema }),
    autoCloseConnection: true,
  };
}
