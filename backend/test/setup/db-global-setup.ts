import { execSync } from 'node:child_process';
import { Client } from 'pg';
import { TEST_DB } from './test-database.env';

/**
 * Runs once before `npm run test:db`: recreates the test database and applies the
 * real migration pipeline (`script/migrate.ts`), so tests see exactly what
 * production gets, including the fortis_app role, RLS policies and SQL functions.
 */
export default async function globalSetup(): Promise<void> {
  const admin = new Client({ connectionString: TEST_DB.adminUrl });
  await admin.connect();
  try {
    await admin.query(
      `DROP DATABASE IF EXISTS ${TEST_DB.databaseName} WITH (FORCE)`,
    );
    await admin.query(`CREATE DATABASE ${TEST_DB.databaseName}`);
  } finally {
    await admin.end();
  }

  execSync('npx ts-node script/migrate.ts', {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_MIGRATION_URL: TEST_DB.migrationUrl,
      DATABASE_URL: TEST_DB.appUrl,
      FORTIS_APP_DB_PASSWORD: TEST_DB.appPassword,
    },
  });
}
