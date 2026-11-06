import { Injectable } from '@nestjs/common';
import { Request } from 'express';
import { createHash } from 'crypto';

export interface RateLimitKeyGeneratorOptions {
  /**
   * Whether to include business ID in the key for authenticated users
   * Default: true
   */
  includeBusinessId?: boolean;

  /**
   * Whether to include branch ID in the key for authenticated users
   * Default: false
   */
  includeBranchId?: boolean;

  /**
   * Custom header name for device fingerprint
   * Default: 'X-Device-Fingerprint'
   */
  deviceFingerprintHeader?: string;

  /**
   * Header name for region detection (e.g., 'X-Region', 'CF-IPCountry')
   * Default: 'X-Region'
   */
  regionHeader?: string;

  /**
   * Whether to include region in the key
   * Default: false
   */
  includeRegion?: boolean;

  /**
   * Header name for API key
   * Default: 'X-API-Key'
   */
  apiKeyHeader?: string;

  /**
   * Whether to include API key in the key
   * Default: false
   */
  includeApiKey?: boolean;

  /**
   * Whether to hash the final key
   * Default: true
   */
  hashKey?: boolean;
}

@Injectable()
export class RateLimitKeyGenerator {
  private readonly options: Required<RateLimitKeyGeneratorOptions>;

  constructor() {
    this.options = {
      includeBusinessId: true,
      includeBranchId: false,
      deviceFingerprintHeader: 'X-Device-Fingerprint',
      regionHeader: 'X-Region',
      includeRegion: true, // Enable region inclusion by default for regional distribution
      apiKeyHeader: 'X-API-Key',
      includeApiKey: true, // Enable API key inclusion by default for API key support
      hashKey: true,
    };
  }

  /**
   * Update the options for the key generator
   */
  updateOptions(options: Partial<RateLimitKeyGeneratorOptions>): void {
    Object.assign(this.options, options);
  }

  /**
   * Generate a unique key for rate limiting based on the request
   */
  generateKey(req: Request): string {
    const method = req.method;
    const path = req.path;

    // Get the primary identifier based on authentication status
    const primaryIdentifier = this.getPrimaryIdentifier(req);

    // Build key parts
    const keyParts = [primaryIdentifier];

    // Add region if enabled and present
    const region = this.getRegion(req);
    if (region) {
      keyParts.push(`region:${region}`);
    }

    // Add API key if enabled and present
    const apiKey = this.getApiKey(req);
    if (apiKey) {
      keyParts.push(`api:${this.hashString(apiKey)}`);
    }

    // Add method and path context
    keyParts.push(method, path);

    // Combine parts with separator
    let key = keyParts.join(':');

    // Hash the key if configured
    if (this.options.hashKey) {
      key = this.hashString(key);
    }

    return key;
  }

  /**
   * Get primary identifier for the client with fallback hierarchy:
   * 1. User ID for authenticated users
   * 2. Session ID for anonymous users with session
   * 3. Device fingerprint as final fallback
   */
  private getPrimaryIdentifier(req: Request): string {
    // 1. Check for authenticated user
    const user = (req as any).user;
    const userId = user?.userId || user?.id;
    if (userId) {
      return this.getAuthenticatedUserIdentifier(user);
    }

    // 2. Check for session ID
    const sessionId = this.getSessionId(req);
    if (sessionId) {
      return `session:${sessionId}`;
    }

    // 3. Fallback to device fingerprint
    const deviceFingerprint = this.getDeviceFingerprint(req);
    return `device:${deviceFingerprint}`;
  }

  /**
   * Get identifier for authenticated user
   */
  private getAuthenticatedUserIdentifier(user: any): string {
    const userId = user.userId || user.id;
    const parts = ['user', userId];

    if (this.options.includeBusinessId && user.businessId) {
      parts.push(`business:${user.businessId}`);
    }

    if (this.options.includeBranchId && user.branchId) {
      parts.push(`branch:${user.branchId}`);
    }

    return parts.join(':');
  }

  /**
   * Extract session ID from request
   */
  private getSessionId(req: Request): string | null {
    // Try express session ID
    if ((req as any).sessionID) {
      return (req as any).sessionID;
    }

    // Try session cookie
    if (req.cookies && req.cookies['connect.sid']) {
      // Extract session ID from cookie value (might be signed)
      const cookieValue = req.cookies['connect.sid'];
      // Simple extraction - in production you might need to unsign
      return cookieValue.split('.')[0];
    }

    return null;
  }

  /**
   * Generate or extract device fingerprint
   */
  private getDeviceFingerprint(req: Request): string {
    // Try custom header first
    const customFingerprint = req.headers[this.options.deviceFingerprintHeader.toLowerCase()];
    if (customFingerprint && typeof customFingerprint === 'string') {
      return customFingerprint;
    }

    // Generate fingerprint from request characteristics
    const fingerprintData = [
      req.ip || (req as any).connection?.remoteAddress || 'unknown',
      req.headers['user-agent'] || '',
      req.headers['accept-language'] || '',
      req.headers['accept-encoding'] || '',
    ].join('|');

    return this.hashString(fingerprintData);
  }

  private getRegion(req: Request): string | null {
    if (!this.options.includeRegion) {
      return null;
    }
    const regionHeader = req.headers[this.options.regionHeader.toLowerCase()];
    if (regionHeader && typeof regionHeader === 'string') {
      return regionHeader.trim().toLowerCase();
    }
    return null;
  }

  private getApiKey(req: Request): string | null {
    if (!this.options.includeApiKey) {
      return null;
    }
    const apiKeyHeader = req.headers[this.options.apiKeyHeader.toLowerCase()];
    if (apiKeyHeader && typeof apiKeyHeader === 'string') {
      return apiKeyHeader.trim();
    }
    return null;
  }

  /**
   * Hash a string to consistent short representation
   */
  private hashString(str: string): string {
    // Use SHA-256 for better distribution
    const hash = createHash('sha256').update(str).digest('hex');
    // Take first 16 chars for shorter key (still 128 bits)
    return hash.substring(0, 16);
  }
}