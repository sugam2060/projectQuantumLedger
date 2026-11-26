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
  const reference = await referenceData();
  await owner().query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
  await restoreReferenceData(reference);
}

/**
 * Reference data seeded by migrations (permission catalogue, system roles and
 * their grants). TRUNCATE ... CASCADE also empties it, so it is captured once
 * from the freshly migrated database and put back after every truncate.
 */
type ReferenceData = {
  permissions: Record<string, unknown>[];
  roles: Record<string, unknown>[];
  grants: Record<string, unknown>[];
};
let reference: ReferenceData | undefined;

async function referenceData(): Promise<ReferenceData> {
  if (reference) return reference;
  const db = owner();
  const [permissions, roles, grants] = await Promise.all([
    db.query('SELECT * FROM permissions'),
    db.query('SELECT * FROM roles WHERE is_system'),
    db.query(
      `SELECT rp.* FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id WHERE r.is_system`,
    ),
  ]);
  reference = {
    permissions: permissions.rows,
    roles: roles.rows,
    grants: grants.rows,
  };
  return reference;
}

async function restoreReferenceData(data: ReferenceData): Promise<void> {
  const db = owner();
  for (const [table, rows] of [
    ['permissions', data.permissions],
    ['roles', data.roles],
    ['role_permissions', data.grants],
  ] as const) {
    if (rows.length === 0) continue;
    await db.query(
      `INSERT INTO ${table} SELECT * FROM json_populate_recordset(NULL::${table}, $1)`,
      [JSON.stringify(rows)],
    );
  }
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
