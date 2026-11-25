import { UnauthorizedException } from '@nestjs/common';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Claim readers shared by both strategies; any malformed claim is a 401. */
export function requireUuidClaim(value: unknown, claim: string): string {
  const uuid = optionalUuidClaim(value, claim);
  if (!uuid) {
    throw new UnauthorizedException(`Missing or invalid ${claim} claim`);
  }
  return uuid;
}

export function optionalUuidClaim(
  value: unknown,
  claim: string,
): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new UnauthorizedException(`Invalid ${claim} claim`);
  }
  return value;
}

export function optionalStringClaim(
  value: unknown,
  claim: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new UnauthorizedException(`Invalid ${claim} claim`);
  }
  return value;
}

export function requireExpiry(value: unknown): number {
  if (typeof value !== 'number' || value <= Math.floor(Date.now() / 1000)) {
    throw new UnauthorizedException('JWT must have a valid expiration');
  }
  return value;
}
