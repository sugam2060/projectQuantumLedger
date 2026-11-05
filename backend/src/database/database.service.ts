import type { Pool } from 'pg';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export abstract class DatabaseService extends NodePgDatabase<typeof schema> {
  declare readonly $client: Pool;
}
