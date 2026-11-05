import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

const backendDirectory = resolve(__dirname, '..');
const scriptDirectory = resolve(backendDirectory, 'scripts');


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
    const client = await pool.connect();
    try {
      console.info('Applying core helper and security-definer SQL first...');
      const [helperFunctionsSql, securityDefinerSql] = await Promise.all([
        readFile(resolve(scriptDirectory, 'core_helper_function.sql'), 'utf8'),
        readFile(resolve(scriptDirectory, 'core_security_definer.sql'), 'utf8'),
      ]);

      await client.query('BEGIN');
      await client.query(helperFunctionsSql);
      await client.query(securityDefinerSql);
      await client.query('COMMIT');
      console.info('Core helpers applied successfully.');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    console.info('Applying Drizzle migrations...');
    await migrate(drizzle(pool), {
      migrationsFolder: resolve(backendDirectory, 'drizzle'),
    });

    console.info('Database migrations completed.');
  } finally {
    await pool.end();
  }
}

runMigrations().catch((error: unknown) => {
  console.error('Database migration failed:', error);
  process.exitCode = 1;
});
