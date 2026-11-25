import type { ConfigType } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { databaseConfig } from '../config';
import * as schema from './schema';

/**
 * Builds the Drizzle client over a pg pool. Values were validated at startup by
 * `validateEnv`, so this only wires them.
 */
export function createDatabaseOptions(
  config: ConfigType<typeof databaseConfig>,
) {
  const pool = new Pool({
    connectionString: config.url,
    max: config.pool.max,
    min: config.pool.min,
    idleTimeoutMillis: config.pool.idleTimeoutMs,
    connectionTimeoutMillis: config.pool.connectionTimeoutMs,
  });

  return {
    db: drizzle(pool, { schema }),
    autoCloseConnection: true,
  };
}
