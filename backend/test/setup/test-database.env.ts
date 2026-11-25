/**
 * Connection settings for `npm run test:db` (see docker-compose.test.yml). Each can
 * be overridden from the environment, e.g. in CI with service containers.
 */
export const TEST_DB = {
  adminUrl:
    process.env.TEST_DATABASE_ADMIN_URL ??
    'postgres://fortis_owner:fortis_owner_test_password@localhost:55432/postgres',
  migrationUrl:
    process.env.TEST_DATABASE_MIGRATION_URL ??
    'postgres://fortis_owner:fortis_owner_test_password@localhost:55432/fortis_test',
  appUrl:
    process.env.TEST_DATABASE_URL ??
    'postgres://fortis_app:fortis_app_test_password@localhost:55432/fortis_test',
  appPassword:
    process.env.TEST_FORTIS_APP_DB_PASSWORD ?? 'fortis_app_test_password',
  databaseName: 'fortis_test',
  redisUrl: process.env.TEST_REDIS_URL ?? 'redis://localhost:56379/0',
};
