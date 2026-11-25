import { createHash, randomBytes } from 'node:crypto';

/**
 * Opaque tokens (refresh tokens, reset links, invitations): 32 random bytes,
 * base64url. Only `hashOpaqueToken(token)` is ever stored. No salt is needed
 * because the token itself has 256 bits of entropy.
 */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Lower-case hex SHA-256 of the token, the only form kept in the database. */
export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Cheap shape check before hashing user input (43 base64url characters). */
export function isOpaqueTokenShape(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}
