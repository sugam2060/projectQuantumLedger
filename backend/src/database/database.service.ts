import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { schema } from './schema';

/** Owns the shared PostgreSQL pool and Drizzle client for the application. */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  readonly pool: Pool;
  readonly db: NodePgDatabase<typeof schema>;

  constructor(config: ConfigService) {
    this.pool = new Pool({
      connectionString: config.getOrThrow<string>('DATABASE_URL'),
      // This limit is per process. Set it with the database connection budget
      // and number of backend replicas in mind.
      max: this.readPositiveInteger(config, 'DB_POOL_MAX', 20),
      idleTimeoutMillis: this.readPositiveInteger(
        config,
        'DB_POOL_IDLE_TIMEOUT_MS',
        30_000,
      ),
      connectionTimeoutMillis: this.readPositiveInteger(
        config,
        'DB_POOL_CONNECTION_TIMEOUT_MS',
        5_000,
      ),
      maxUses: this.readPositiveInteger(config, 'DB_POOL_MAX_USES', 7_500),
      keepAlive: true,
    });
    this.pool.on('error', (error: Error) => {
      // pg-pool emits errors for idle clients that the server closes. Without
      // a listener Node treats the event as unhandled and exits the process.
      // The pool removes the failed client and creates a replacement as needed.
      this.logger.error(`Idle PostgreSQL connection failed: ${error.message}`);
    });

    this.db = drizzle({ client: this.pool, schema });
  }

  async onModuleInit() {
    await this.pool.query('SELECT 1');
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  private readPositiveInteger(
    config: ConfigService,
    key: string,
    defaultValue: number,
  ): number {
    const rawValue = config.get<string>(key);
    if (rawValue === undefined || rawValue.trim() === '') return defaultValue;

    const value = Number(rawValue);
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${key} must be a positive integer`);
    }
    return value;
  }
}
