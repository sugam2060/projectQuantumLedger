import { appConfig } from '../app.config';
import { authConfig } from '../auth.config';
import { databaseConfig } from '../database.config';
import { redisConfig } from '../redis.config';
import { storageConfig } from '../storage.config';
import { throttleConfig } from '../throttle.config';

describe('config factories', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('applies defaults for optional app and database settings', () => {
    process.env = {
      DATABASE_URL: 'postgres://u:p@localhost/db',
    };
    expect(appConfig()).toEqual({
      nodeEnv: 'development',
      isProduction: false,
      port: 3001,
      apiPrefix: '/api/v1',
      frontendBaseUrl: undefined,
      corsOrigins: [],
      trustProxy: false,
    });
    expect(databaseConfig()).toEqual({
      url: 'postgres://u:p@localhost/db',
      pool: {
        max: 10,
        min: 0,
        idleTimeoutMs: 30000,
        connectionTimeoutMs: 5000,
      },
    });
  });

  it('reads explicit values', () => {
    process.env = {
      NODE_ENV: 'production',
      PORT: '8080',
      FRONTEND_BASE_URL: 'https://fortis.example/app',
      CORS_ALLOWED_ORIGINS:
        'https://pos.fortis.example, https://fortis.example',
      TRUST_PROXY: '1',
      JWT_SECRET: 's'.repeat(40),
      REDIS_URL: 'rediss://cache:6380/1',
      CLOUDINARY_CLOUD_NAME: 'cloud',
    };
    expect(appConfig()).toMatchObject({
      nodeEnv: 'production',
      isProduction: true,
      port: 8080,
      frontendBaseUrl: 'https://fortis.example/app',
      corsOrigins: ['https://fortis.example', 'https://pos.fortis.example'],
      trustProxy: 1,
    });
    expect(throttleConfig()).toEqual({
      ttlMs: 60_000,
      limit: 100,
      authLimit: 10,
    });
    expect(authConfig()).toEqual({
      jwtSecret: 's'.repeat(40),
      accessTtl: '15m',
      accessTtlSeconds: 900,
      issuer: 'fortis-api',
      audience: 'fortis-pos',
      platformAudience: 'fortis-platform',
      refreshPersistentTtlSeconds: 30 * 86_400,
      refreshSessionTtlSeconds: 12 * 3600,
    });
    expect(redisConfig()).toEqual({ url: 'rediss://cache:6380/1' });
    expect(storageConfig().cloudinary).toEqual({
      cloudName: 'cloud',
      apiKey: undefined,
      apiSecret: undefined,
      businessRequestFolder: 'business-request-documents',
    });
  });
});
