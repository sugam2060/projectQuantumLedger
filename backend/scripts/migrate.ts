import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

const backendDirectory = resolve(__dirname, '..');
const scriptDirectory = resolve(backendDirectory, 'scripts');
const appRole = 'fortis_app';

function quoteSqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function applySqlFile(
  pool: Pool,
  filename: string,
  replacements: Record<string, string> = {},
) {
  let statement = await readFile(resolve(scriptDirectory, filename), 'utf8');
  for (const [placeholder, value] of Object.entries(replacements)) {
    statement = statement.replaceAll(placeholder, value);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(statement);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function runtimeRolePassword(): string | undefined {
  const configuredPassword = process.env.FORTIS_APP_DB_PASSWORD;
  if (configuredPassword?.trim()) {
    return configuredPassword;
  }

  const runtimeUrl = process.env.DATABASE_URL;
  if (!runtimeUrl) {
    return undefined;
  }

  const credentials = new URL(runtimeUrl);
  if (decodeURIComponent(credentials.username) !== appRole) {
    return undefined;
  }
  return credentials.password
    ? decodeURIComponent(credentials.password)
    : undefined;
}

async function runMigrations() {
  const envFile = resolve(backendDirectory, '.env');
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }

  const connectionString = process.env.DATABASE_MIGRATION_URL;
  if (!connectionString?.trim()) {
    throw new Error(
      'DATABASE_MIGRATION_URL must be set in the environment or backend/.env. Use a database owner/migration account, not the runtime fortis_app account.',
    );
  }

  const pool = new Pool({ connectionString });

  try {
    console.info('Ensuring the fortis_app runtime role exists...');
    const appPassword = runtimeRolePassword();
    await applySqlFile(pool, 'fortis_app_creation.sql', {
      '__FORTIS_APP_PASSWORD_LITERAL__': appPassword
        ? quoteSqlLiteral(appPassword)
        : 'NULL',
    });

    console.info('Applying core RLS helper functions...');
    await applySqlFile(pool, 'core_helper_function.sql');

    console.info('Applying Drizzle migrations...');
    await migrate(drizzle(pool), {
      migrationsFolder: resolve(backendDirectory, 'drizzle'),
    });

    console.info('Applying core security-definer SQL...');
    await applySqlFile(pool, 'core_security_definer.sql');

    console.info('Granting least-privilege runtime access...');
    await applySqlFile(pool, 'fortis_app_privileges.sql');

    console.info('Database migrations completed.');
  } finally {
    await pool.end();
  }
}

runMigrations().catch((error: unknown) => {
  console.error('Database migration failed:', error);
  process.exitCode = 1;
});
