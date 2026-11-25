import { Injectable } from '@nestjs/common';
import { type Algorithm, hash, verify } from '@node-rs/argon2';
import bcrypt from 'bcryptjs';

/** OWASP-recommended argon2id parameters (19 MiB, t=2, p=1). */
const ARGON2_OPTIONS = {
  // Algorithm.Argon2id; the package exports a const enum, unusable with isolatedModules.
  algorithm: 2 as Algorithm,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** Precomputed hash used to spend the same time when an account is unknown. */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$ZHVtbXlzYWx0ZHVtbXlzYWx0$1Cd8U6dSt6w5qz9EMRvHn4dL9mFsU6wZJw8kM2rG2Ec';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordCheck = {
  valid: boolean;
  /** True when the stored hash should be replaced (legacy bcrypt). */
  needsRehash: boolean;
};

/**
 * Password hashing for business and platform users. New hashes are argon2id;
 * bcrypt hashes from before the migration still verify and are flagged for
 * rehash. `verify` never throws: a malformed hash is simply "not valid".
 */
@Injectable()
export class PasswordService {
  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  async verify(storedHash: string, password: string): Promise<PasswordCheck> {
    try {
      if (storedHash.startsWith('$argon2')) {
        return {
          valid: await verify(storedHash, password),
          needsRehash: false,
        };
      }
      if (/^\$2[aby]\$/.test(storedHash)) {
        const valid = await bcrypt.compare(password, storedHash);
        return { valid, needsRehash: valid };
      }
    } catch {
      // fall through: an unreadable hash never matches
    }
    return { valid: false, needsRehash: false };
  }

  /**
   * Runs a full argon2 verification against a fixed hash and always reports
   * failure, so "unknown email" takes as long as "wrong password".
   */
  async verifyAgainstDummy(password: string): Promise<false> {
    await verify(DUMMY_HASH, password).catch(() => false);
    return false;
  }
}
