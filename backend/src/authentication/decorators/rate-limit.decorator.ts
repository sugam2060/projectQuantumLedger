import { SetMetadata } from '@nestjs/common';
import { RateLimitOptions } from '../../utils/ratelimit.middleware';

export const RATE_LIMIT_KEY = 'rateLimit';

/**
 * Rate limiting decorator for NestJS endpoints with business considerations
 *
 * @param options Rate limiting configuration
 *
 * Example usage:
 *
 * // Basic rate limit: 10 requests per minute
 * @RateLimit({ requests: 10, windowMs: 60000 })
 * @Post('login')
 * login() { ... }
 *
 * // Advanced rate limit with business considerations:
 * @RateLimit({
 *   requests: 100,
 *   windowMs: 3600000,
 *   errorMessage: 'Too many attempts, please try again later',
 *   // Adaptive limits based on user roles/tiers
 *   adaptiveLimits: [
 *     { role: 'admin', requests: 500 },
 *     { tier: 'premium', requests: 300 },
 *     { role: 'user', requests: 100 }
 *   ],
 *   // Premium user features
 *   gracePeriodMs: 5000, // Extra 5 seconds for premium users
 *   premiumMultiplier: 2, // Double limit for premium users
 *   // Regional distribution
 *   regions: {
 *     'us': { requests: 200, windowMs: 3600000 },
 *     'eu': { requests: 150, windowMs: 3600000 },
 *     'asia': { requests: 100, windowMs: 3600000 }
 *   },
 *   // API key support
 *   apiKeyLimit: { requests: 1000, windowMs: 3600000 },
 *   apiKeyHeader: 'x-api-key',
 *   // Dynamic adjustment based on system load
 *   dynamicAdjustment: true,
 *   loadThreshold: 0.8, // 80% load threshold
 *   // Security enhancements
 *   burstLimit: 10, // Max 10 requests per second
 *   burstWindowMs: 1000,
 *   whitelist: {
 *     ips: ['127.0.0.1', '192.168.1.1'],
 *     userIds: ['admin-user-id']
 *   },
 *   enableLogging: true,
 *   logLevel: 'info'
 * })
 * @Get('profile')
 * getProfile() { ... }
 */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);