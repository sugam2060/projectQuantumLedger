import { registerAs } from '@nestjs/config';
import { readRequiredString } from './env.util';
import type { AuthConfig } from './types';

/** Token signing settings. */
export const authConfig = registerAs('auth', (): AuthConfig => ({
  jwtSecret: readRequiredString('JWT_SECRET'),
}));
