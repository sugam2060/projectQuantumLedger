import { appConfig } from '../app.config';
import { authConfig } from '../auth.config';
import { databaseConfig } from '../database.config';
import { redisConfig } from '../redis.config';
import { storageConfig } from '../storage.config';

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
      port: 3001,
      apiPrefix: '/api/v1',
      frontendBaseUrl: undefined,
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
      FRONTEND_BASE_URL: 'https://fortis.example',
      JWT_SECRET: 's'.repeat(40),
      REDIS_URL: 'rediss://cache:6380/1',
      CLOUDINARY_CLOUD_NAME: 'cloud',
    };
    expect(appConfig()).toMatchObject({
      nodeEnv: 'production',
      port: 8080,
      frontendBaseUrl: 'https://fortis.example',
    });
    expect(authConfig()).toEqual({ jwtSecret: 's'.repeat(40) });
    expect(redisConfig()).toEqual({ url: 'rediss://cache:6380/1' });
    expect(storageConfig().cloudinary).toEqual({
      cloudName: 'cloud',
      apiKey: undefined,
      apiSecret: undefined,
      businessRequestFolder: 'business-request-documents',
    });
  });
});
