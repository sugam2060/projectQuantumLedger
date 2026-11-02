import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Inject,
} from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { schema } from './schema/schema';
import { DATABASE, DATABASE_POOL } from './database.providers';

/** Owns the shared PostgreSQL pool and Drizzle client for the application. */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(
    @Inject(DATABASE_POOL) public readonly pool: Pool,
    @Inject(DATABASE) public readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async onModuleInit() {
    await this.pool.query('SELECT 1');
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
