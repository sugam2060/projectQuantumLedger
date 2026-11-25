import { plainToInstance } from 'class-transformer';
import {
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

  @IsString()
  @MinLength(32)
  JWT_SECRET!: string;

  @IsOptional()
  @IsUrl({
    protocols: ['http', 'https'],
    require_tld: false,
    require_protocol: true,
  })
  FRONTEND_BASE_URL?: string;
}

const NUMERIC_KEYS = [
  'PORT',
  'DB_POOL_MAX',
  'DB_POOL_MIN',
  'DB_POOL_IDLE_TIMEOUT_MS',
  'DB_POOL_CONNECTION_TIMEOUT_MS',
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

  const candidate = plainToInstance(EnvironmentVariables, {
    ...config,
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

  if (messages.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n${messages.join('\n')}`,
    );
  }

  return config;
}
