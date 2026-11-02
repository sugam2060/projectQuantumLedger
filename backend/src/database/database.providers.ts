import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { schema } from './schema/schema';
import { Logger } from '@nestjs/common';

export const DATABASE_POOL = Symbol('DATABASE_POOL');
export const DATABASE = Symbol('DATABASE');

export interface DatabasePoolConfig {
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  maxUses?: number;
}

export const databaseProviders: Provider[] = [
  {
    provide: DATABASE_POOL,
    useFactory: (config: ConfigService) => {
      const logger = new Logger('DatabasePool');

      const pool = new Pool({
        connectionString: config.getOrThrow<string>('DATABASE_URL'),
        max: config.get<number>('DB_POOL_MAX', 20),
        idleTimeoutMillis: config.get<number>('DB_POOL_IDLE_TIMEOUT_MS', 30_000),
        connectionTimeoutMillis: config.get<number>('DB_POOL_CONNECTION_TIMEOUT_MS', 5_000),
        maxUses: config.get<number>('DB_POOL_MAX_USES', 7_500),
        keepAlive: true,
      });

      pool.on('error', (error: Error) => {
        logger.error(`Idle PostgreSQL connection failed: ${error.message}`);
      });

      return pool;
    },
    inject: [ConfigService],
  },
  {
    provide: DATABASE,
    useFactory: (pool: Pool) => {
      return drizzle({ client: pool, schema });
    },
    inject: [DATABASE_POOL],
  },
];