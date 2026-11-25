import { validateEnv } from '../env.validation';

const validEnv = (): Record<string, string> => ({
  DATABASE_URL: 'postgres://fortis_app:secret@localhost:5432/fortis',
  REDIS_URL: 'redis://localhost:6379/0',
  JWT_SECRET: 'x'.repeat(32),
});

describe('validateEnv', () => {
  it('accepts the minimal required variables', () => {
    expect(() => validateEnv(validEnv())).not.toThrow();
  });

  it('keeps variables it does not know about', () => {
    const result = validateEnv({ ...validEnv(), MAIL_HOST: 'smtp.local' });
    expect(result.MAIL_HOST).toBe('smtp.local');
  });

  it.each(['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET'])(
    'fails when %s is missing',
    (key) => {
      const env = validEnv();
      delete env[key];
      expect(() => validateEnv(env)).toThrow(key);
    },
  );

  it('rejects a JWT secret shorter than 32 characters', () => {
    expect(() => validateEnv({ ...validEnv(), JWT_SECRET: 'short' })).toThrow(
      'JWT_SECRET',
    );
  });

  it('rejects a non-redis REDIS_URL', () => {
    expect(() =>
      validateEnv({ ...validEnv(), REDIS_URL: 'http://localhost' }),
    ).toThrow('REDIS_URL');
  });

  it('rejects an out-of-range PORT', () => {
    expect(() => validateEnv({ ...validEnv(), PORT: '70000' })).toThrow('PORT');
  });

  it('rejects DB_POOL_MIN greater than DB_POOL_MAX', () => {
    expect(() =>
      validateEnv({ ...validEnv(), DB_POOL_MIN: '5', DB_POOL_MAX: '2' }),
    ).toThrow('DB_POOL_MIN');
  });

  it('rejects a non-http FRONTEND_BASE_URL', () => {
    expect(() =>
      validateEnv({ ...validEnv(), FRONTEND_BASE_URL: 'not a url' }),
    ).toThrow('FRONTEND_BASE_URL');
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => validateEnv({ ...validEnv(), NODE_ENV: 'staging' })).toThrow(
      'NODE_ENV',
    );
  });

  it('rejects an invalid TRUST_PROXY', () => {
    expect(() => validateEnv({ ...validEnv(), TRUST_PROXY: 'maybe' })).toThrow(
      'TRUST_PROXY',
    );
  });

  it('rejects a CORS origin with a path', () => {
    expect(() =>
      validateEnv({
        ...validEnv(),
        CORS_ALLOWED_ORIGINS: 'https://ok.example, https://bad.example/path',
      }),
    ).toThrow('CORS_ALLOWED_ORIGINS');
  });

  it('rejects a throttle limit below 1', () => {
    expect(() =>
      validateEnv({ ...validEnv(), AUTH_THROTTLE_LIMIT: '0' }),
    ).toThrow('AUTH_THROTTLE_LIMIT');
  });
});
