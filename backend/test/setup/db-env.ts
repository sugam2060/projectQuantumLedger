import { TEST_DB } from './test-database.env';

// Point the application at the throwaway test services before AppModule loads.
process.env.DATABASE_URL = TEST_DB.appUrl;
process.env.DATABASE_MIGRATION_URL = TEST_DB.migrationUrl;
process.env.REDIS_URL = TEST_DB.redisUrl;
process.env.JOBS_WORKERS_ENABLED = 'false';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-at-least-32-characters';
// Generous limits so suites are not throttled; throttling has its own tests.
process.env.THROTTLE_LIMIT = '10000';
process.env.AUTH_THROTTLE_LIMIT = '10000';
