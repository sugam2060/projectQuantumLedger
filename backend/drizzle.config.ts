import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'drizzle-kit';

const envFile = resolve(__dirname, '.env');
// Variables already in the environment win over the file.
if (existsSync(envFile)) process.loadEnvFile(envFile);

// drizzle-kit (studio, introspection) connects as the database owner, like
// script/migrate.ts. The runtime fortis_app role is least-privilege by design
// (no SELECT on users/platform_users password columns), so it cannot browse
// every table.
export default defineConfig({
  out: './drizzle',
  schema: './src/database/schemas/index.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_MIGRATION_URL!,
  },
});
