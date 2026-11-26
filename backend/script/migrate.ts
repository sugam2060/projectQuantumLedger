import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool, type PoolClient } from 'pg';

/**
 * Database migration pipeline (`npm run db:migrate`). Runs as the table owner
 * (DATABASE_MIGRATION_URL), never as the runtime role, in this order:
 *
 *   00-app-role.sql               create/alter the fortis_app runtime role
 *   (password)                    set from FORTIS_APP_DB_PASSWORD via bind parameter
 *                                 (FORTIS_APP_ROLE_EXTERNALLY_MANAGED=true: role made elsewhere)
 *   01-helper-functions.sql       app schema + request-context readers
 *   02-security-functions.sql     SECURITY DEFINER predicates and auth lookups
 *   Drizzle migrations            tables, indexes, RLS policies
 *   03-app-grant-least-privilege  DML + EXECUTE grants for fortis_app
 *   04-seed-authorization.sql     permission catalogue, system roles and their grants
 *
 * The SQL files are idempotent and re-applied on every run. The whole run holds a
 * Postgres advisory lock so two deploys cannot migrate concurrently.
 */

const backendDirectory = resolve(__dirname, '..');
const sqlDirectory = resolve(backendDirectory, 'script', 'sql');
const APP_ROLE = 'fortis_app';
const MIGRATION_LOCK_KEY = 'fortis:db:migrate';

async function applySqlFile(
  client: PoolClient,
  filename: string,
): Promise<void> {
  const statement = await readFile(resolve(sqlDirectory, filename), 'utf8');
  await client.query('BEGIN');
  try {
    await client.query(statement);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/** The runtime password: FORTIS_APP_DB_PASSWORD, else the one in DATABASE_URL. */
function runtimeRolePassword(): string | undefined {
  const configured = process.env.FORTIS_APP_DB_PASSWORD?.trim();
  if (configured) return configured;

  const runtimeUrl = process.env.DATABASE_URL;
  if (!runtimeUrl) return undefined;
  const credentials = new URL(runtimeUrl);
  if (decodeURIComponent(credentials.username) !== APP_ROLE) return undefined;
  return credentials.password
    ? decodeURIComponent(credentials.password)
    : undefined;
}

/**
 * Sets the runtime role password. The value travels only as a bind parameter;
 * Postgres builds the statement with format('%L'), so it is never concatenated
 * into SQL text by this process.
 */
async function setRuntimePassword(client: PoolClient): Promise<void> {
  const password = runtimeRolePassword();
  if (!password) {
    console.info(
      'No FORTIS_APP_DB_PASSWORD (or fortis_app DATABASE_URL); leaving the runtime password unchanged.',
    );
    return;
  }
  const { rows } = await client.query<{ statement: string }>(
    `SELECT pg_catalog.format('ALTER ROLE %I PASSWORD %L', $1::text, $2::text) AS statement`,
    [APP_ROLE, password],
  );
  try {
    await client.query(rows[0].statement);
  } catch (error) {
    // Managed Postgres (Neon, RDS, ...): a CREATEROLE user that is not a
    // superuser may only change passwords of roles it administers (PG16+), i.e.
    // roles it created. Someone else created fortis_app: its password is not
    // under this migration's control, so continue only on explicit opt-in.
    if ((error as { code?: string }).code !== '42501') throw error;
    if (process.env.FORTIS_APP_ROLE_EXTERNALLY_MANAGED?.trim() !== 'true') {
      throw new Error(
        `The migration user may not set the ${APP_ROLE} password: the role was created by another user. ` +
          `Either drop the role (as its creator or a superuser) and migrate again so this migration creates it, ` +
          `or, if you manage ${APP_ROLE} and its password yourself, set FORTIS_APP_ROLE_EXTERNALLY_MANAGED=true.`,
      );
    }
    console.warn(
      `FORTIS_APP_ROLE_EXTERNALLY_MANAGED=true: keeping the externally managed ${APP_ROLE} password.`,
    );
  }
}

/**
 * Seeds the authorization reference data. The file runs in one transaction, so a
 * failure leaves the previous catalogue untouched; the run then fails, because
 * the API cannot authorize anything without permissions and system roles.
 */
async function seedAuthorization(client: PoolClient): Promise<void> {
  const filename = '04-seed-authorization.sql';
  try {
    await applySqlFile(client, filename);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Seeding permissions and system roles (${filename}) failed and was rolled back: ${reason}. ` +
        'Schema migrations are applied; fix the seed file and run `npm run db:migrate` again (it is idempotent).',
      { cause: error },
    );
  }

  const { rows } = await client.query<{ permissions: number; roles: number }>(
    `SELECT (SELECT count(*) FROM permissions)::int AS permissions,
            (SELECT count(*) FROM roles WHERE is_system)::int AS roles`,
  );
  console.info(
    `Seeded ${rows[0].permissions} permissions and ${rows[0].roles} system roles.`,
  );
}

async function runMigrations(): Promise<void> {
  const envFile = resolve(backendDirectory, '.env');
  // Variables already in the environment win over the file.
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const connectionString = process.env.DATABASE_MIGRATION_URL;
  if (!connectionString?.trim()) {
    throw new Error(
      'DATABASE_MIGRATION_URL must be set in the environment or backend/.env. Use a database owner/migration account, not the runtime fortis_app account.',
    );
  }

  const pool = new Pool({ connectionString, max: 2 });
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [
      MIGRATION_LOCK_KEY,
    ]);
    try {
      console.info('Ensuring the fortis_app runtime role exists...');
      await applySqlFile(client, '00-app-role.sql');
      await setRuntimePassword(client);

      console.info('Applying request-context helper functions...');
      await applySqlFile(client, '01-helper-functions.sql');

      console.info('Applying security functions...');
      await applySqlFile(client, '02-security-functions.sql');

      console.info('Applying Drizzle migrations...');
      await migrate(drizzle(pool), {
        migrationsFolder: resolve(backendDirectory, 'drizzle'),
      });

      console.info('Granting least-privilege runtime access...');
      await applySqlFile(client, '03-app-grant-least-privilege.sql');

      console.info('Seeding permissions and system roles...');
      await seedAuthorization(client);

      console.info('Database migrations completed.');
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [
        MIGRATION_LOCK_KEY,
      ]);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch((error: unknown) => {
  console.error('Database migration failed:', error);
  process.exitCode = 1;
});
