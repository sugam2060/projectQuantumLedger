import { registerAs } from '@nestjs/config';
import { readInt } from './env.util';
import type { ThrottleConfig } from './types';

/** Rate limits: a default throttler for every route and a strict one for credential routes. */
export const throttleConfig = registerAs('throttle', (): ThrottleConfig => ({
  ttlMs: readInt('THROTTLE_TTL_MS', 60_000),
  limit: readInt('THROTTLE_LIMIT', 100),
  authLimit: readInt('AUTH_THROTTLE_LIMIT', 10),
}));
