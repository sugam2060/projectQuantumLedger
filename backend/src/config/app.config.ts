import { registerAs } from '@nestjs/config';
import { readInt, readString, splitList } from './env.util';
import { parseTrustProxy } from './trust-proxy';
import type { AppConfig } from './types';

export const API_PREFIX = '/api/v1';
const DEFAULT_PORT = 3001;

/** Process-level settings: environment, port, API prefix, origins and proxy trust. */
export const appConfig = registerAs('app', (): AppConfig => {
  const nodeEnv = readString('NODE_ENV') ?? 'development';
  const frontendBaseUrl = readString('FRONTEND_BASE_URL');
  const corsOrigins = [
    ...(frontendBaseUrl ? [new URL(frontendBaseUrl).origin] : []),
    ...splitList(readString('CORS_ALLOWED_ORIGINS')),
  ];
  return {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    port: readInt('PORT', DEFAULT_PORT),
    apiPrefix: API_PREFIX,
    frontendBaseUrl,
    corsOrigins: [...new Set(corsOrigins)],
    trustProxy: parseTrustProxy(readString('TRUST_PROXY')),
  };
});
