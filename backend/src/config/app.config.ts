import { registerAs } from '@nestjs/config';
import { readInt, readString } from './env.util';
import type { AppConfig } from './types';

export const API_PREFIX = '/api/v1';
const DEFAULT_PORT = 3001;

/** Process-level settings: environment, port, API prefix and the public website origin. */
export const appConfig = registerAs('app', (): AppConfig => ({
  nodeEnv: readString('NODE_ENV') ?? 'development',
  port: readInt('PORT', DEFAULT_PORT),
  apiPrefix: API_PREFIX,
  frontendBaseUrl: readString('FRONTEND_BASE_URL'),
}));
