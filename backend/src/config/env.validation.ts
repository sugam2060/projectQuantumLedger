import { plainToInstance } from 'class-transformer';
import { parseTrustProxy } from './trust-proxy';
import { isHttpOrigin, splitList } from './env.util';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

const NODE_ENVIRONMENTS = ['development', 'production', 'test'] as const;

/**
 * Environment variables checked at startup. Only variables the app reads are
 * declared; anything else is passed through unchanged so modules that have not
 * moved to `registerAs` yet keep working.
 */
class EnvironmentVariables {
  @IsOptional()
  @IsIn(NODE_ENVIRONMENTS)
  NODE_ENV?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT?: number;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  DB_POOL_MAX?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  DB_POOL_MIN?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  DB_POOL_IDLE_TIMEOUT_MS?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  DB_POOL_CONNECTION_TIMEOUT_MS?: number;

  @IsString()
  @Matches(/^rediss?:\/\//, {
    message: 'REDIS_URL must start with redis:// or rediss://',
  })
  REDIS_URL!: string;

  /** Preferred name. JWT_SECRET (old name) is accepted when this is unset. */
  @IsOptional()
  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET?: string;

  @IsOptional()
  @IsString()
  @MinLength(32)
  JWT_SECRET?: string;

  @IsOptional()
  @Matches(/^\d+[smhd]?$/, {
    message: 'JWT_ACCESS_TTL must look like 900, 15m, 1h or 1d',
  })
  JWT_ACCESS_TTL?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  JWT_ISSUER?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  JWT_AUDIENCE?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  JWT_PLATFORM_AUDIENCE?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  REFRESH_TOKEN_TTL_DAYS?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  REFRESH_TOKEN_SESSION_TTL_HOURS?: number;

  @IsOptional()
  @IsUrl({
    protocols: ['http', 'https'],
    require_tld: false,
    require_protocol: true,
  })
  FRONTEND_BASE_URL?: string;

  /** Extra browser origins allowed by CORS, comma separated (FRONTEND_BASE_URL is always allowed). */
  @IsOptional()
  @IsString()
  CORS_ALLOWED_ORIGINS?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  MAIL_HOST?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  MAIL_PORT?: number;

  @IsOptional()
  @IsIn(['true', 'false'])
  MAIL_SECURE?: string;

  @IsOptional()
  @IsEmail()
  MAIL_FROM_EMAIL?: string;

  @IsOptional()
  @IsEmail()
  MAIL_REPLY_TO?: string;

  /** "false" runs this instance as enqueue-only (no BullMQ workers). */
  @IsOptional()
  @IsIn(['true', 'false'])
  JOBS_WORKERS_ENABLED?: string;

  @IsOptional()
  @IsInt()
  @Min(1000)
  THROTTLE_TTL_MS?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  THROTTLE_LIMIT?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  AUTH_THROTTLE_LIMIT?: number;
}

const NUMERIC_KEYS = [
  'PORT',
  'DB_POOL_MAX',
  'DB_POOL_MIN',
  'DB_POOL_IDLE_TIMEOUT_MS',
  'DB_POOL_CONNECTION_TIMEOUT_MS',
  'THROTTLE_TTL_MS',
  'THROTTLE_LIMIT',
  'AUTH_THROTTLE_LIMIT',
  'MAIL_PORT',
  'REFRESH_TOKEN_TTL_DAYS',
  'REFRESH_TOKEN_SESSION_TTL_HOURS',
] as const;

/**
 * `ConfigModule.forRoot({ validate })` hook. Throws one error listing every invalid
 * variable so a misconfigured deployment fails at boot instead of on first use.
 */
export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const numericOverrides: Record<string, number> = {};
  for (const key of NUMERIC_KEYS) {
    const raw = config[key];
    if (typeof raw === 'string' && raw.trim() !== '') {
      numericOverrides[key] = Number(raw);
    }
  }

  // An empty value (`KEY=`) means "not set", as the registerAs readers treat it.
  const present = Object.fromEntries(
    Object.entries(config).filter(
      ([, value]) => !(typeof value === 'string' && value.trim() === ''),
    ),
  );
  const candidate = plainToInstance(EnvironmentVariables, {
    ...present,
    ...numericOverrides,
  });
  const errors = validateSync(candidate, { skipMissingProperties: false });
  const messages = errors.map(
    (error) =>
      `${error.property}: ${Object.values(error.constraints ?? {}).join(', ')}`,
  );

  const poolMin = numericOverrides.DB_POOL_MIN ?? 0;
  const poolMax = numericOverrides.DB_POOL_MAX ?? 10;
  if (poolMin > poolMax) {
    messages.push('DB_POOL_MIN: must not exceed DB_POOL_MAX');
  }

  if (!present.JWT_ACCESS_SECRET && !present.JWT_SECRET) {
    messages.push(
      'JWT_ACCESS_SECRET: is required (JWT_SECRET is accepted as the old name)',
    );
  }
  if (
    typeof present.JWT_AUDIENCE === 'string' &&
    present.JWT_AUDIENCE === present.JWT_PLATFORM_AUDIENCE
  ) {
    messages.push('JWT_PLATFORM_AUDIENCE: must differ from JWT_AUDIENCE');
  }

  try {
    parseTrustProxy(
      typeof config.TRUST_PROXY === 'string' ? config.TRUST_PROXY : undefined,
    );
  } catch (error) {
    messages.push(
      error instanceof Error ? error.message : 'TRUST_PROXY is invalid',
    );
  }

  const origins =
    typeof config.CORS_ALLOWED_ORIGINS === 'string'
      ? config.CORS_ALLOWED_ORIGINS
      : '';
  for (const origin of splitList(origins)) {
    if (!isHttpOrigin(origin)) {
      messages.push(
        `CORS_ALLOWED_ORIGINS: "${origin}" is not an http(s) origin`,
      );
    }
  }

  if (messages.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n${messages.join('\n')}`,
    );
  }

  return config;
}
