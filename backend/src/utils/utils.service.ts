import { Injectable } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';

@Injectable()
export class UtilsService {
  /**
   * Generates a refresh token
   * @returns A base64 encoded hashed string
   */
  generateRefreshToken(): string {
    // Generate 32 random bytes
    const buffer = randomBytes(32);

    // Create a hash of the random bytes
    const hash = createHash('sha256').update(buffer).digest('hex');

    // Encode as base64 for compact representation
    return Buffer.from(hash).toString('base64');
  }
}
