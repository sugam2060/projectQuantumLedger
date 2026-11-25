import { Pool, type PoolClient } from 'pg';
import { TEST_DB } from '../../setup/test-database.env';

let ownerPool: Pool | undefined;
let appPool: Pool | undefined;

/** Pool connected as the table owner (bypasses RLS). Use for setup and assertions. */
export function owner(): Pool {
  ownerPool ??= new Pool({ connectionString: TEST_DB.migrationUrl, max: 4 });
  return ownerPool;
}

/** Pool connected as the runtime role `fortis_app` (RLS applies). */
export function app(): Pool {
  appPool ??= new Pool({ connectionString: TEST_DB.appUrl, max: 4 });
  return appPool;
}

export async function closePools(): Promise<void> {
  await Promise.all([ownerPool?.end(), appPool?.end()]);
  ownerPool = undefined;
  appPool = undefined;
}

/** Empties every application table (keeps the migration ledger). */
export async function truncateAll(): Promise<void> {
  const { rows } = await owner().query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename NOT LIKE '%drizzle%'`,
  );
  if (rows.length === 0) return;
  const tables = rows.map((row) => `"public"."${row.tablename}"`).join(', ');
  await owner().query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
}

/**
 * Runs `work` as fortis_app inside a transaction with the given transaction-local
 * settings (e.g. `{ 'app.business_id': id }`), then rolls back.
 */
export async function asApp<T>(
  settings: Record<string, string>,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await app().connect();
  try {
    await client.query('BEGIN');
    for (const [key, value] of Object.entries(settings)) {
      await client.query('SELECT set_config($1, $2, true)', [key, value]);
    }
    return await work(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}
