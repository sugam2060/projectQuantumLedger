import { Injectable, NestMiddleware, HttpStatus, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';
import { RedisService } from '../redis/redis.service';
import { RateLimitKeyGenerator } from './rate-limit-key.generator';
import * as os from 'os';

export interface RateLimitOptions {
  requests: number;           // Number of requests allowed
  windowMs: number;            // Time window in milliseconds
  keyPrefix?: string;         // Prefix for Redis keys
  errorMessage?: string;      // Custom error message
  // Security enhancements
  adaptiveLimits?: {          // Adaptive limits based on user roles/tiers
    role?: string;            // Role name (optional)
    tier?: string;            // Tier name (optional)
    requests: number;         // Allowed requests for this role/tier
  }[];
  burstLimit?: number;        // Maximum requests allowed in a burst window (e.g., per second)
  burstWindowMs?: number;     // Burst window in milliseconds (default: 1000ms)
  whitelist?: {               // Whitelist configuration
    ips?: string[];           // List of trusted IP addresses
    userIds?: string[];       // List of trusted user IDs
  };
  enableLogging?: boolean;    // Enable detailed security logging
  logLevel?: 'info' | 'warn' | 'error'; // Log level for security events
  // Business considerations
  gracePeriodMs?: number;                 // Extra window for premium users (milliseconds)
  premiumMultiplier?: number;             // Multiplier for premium users (default: 1)
  dynamicAdjustment?: boolean;            // Enable dynamic adjustment based on system load
  loadThreshold?: number;                 // System load threshold (0-1) for adjustment
  regions?: Record<string, { requests: number, windowMs: number }>; // Region-specific limits
  apiKeyLimit?: { requests: number, windowMs: number }; // Limit for API key requests
  apiKeyHeader?: string;                  // Header name for API key (default: 'x-api-key')
}

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RateLimitMiddleware.name);
  private localRateLimitCache?: Map<string, number[]>;
  private readonly REDIS_TIMEOUT_MS = 1000;
  private readonly INSTANCE_HEARTBEAT_INTERVAL = 30000; // 30 seconds
  private readonly INSTANCE_TTL_MS = 60000; // 60 seconds
  private readonly CIRCUIT_BREAKER_THRESHOLD = 5;
  private readonly CIRCUIT_BREAKER_RESET_MS = 60000; // 1 minute
  private redisFailureCount = 0;
  private circuitBreakerOpen = false;
  private circuitBreakerOpenedAt = 0;

  private redisAvailable = true;

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
    private readonly rateLimitKeyGenerator: RateLimitKeyGenerator,
  ) {
    // Register this instance for distributed coordination
    this.registerInstance().catch((error) => {
      this.logger.log('Failed to register instance, running in standalone mode');
      this.redisAvailable = false;
    });
  }

  // Distributed coordination methods
  private async registerInstance(): Promise<void> {
    const instanceId = this.generateInstanceId();
    const instanceKey = `rate-limit:instances:${instanceId}`;
    const instanceData = {
      id: instanceId,
      hostname: os.hostname(),
      pid: process.pid,
      registeredAt: Date.now(),
      lastHeartbeat: Date.now(),
    };

    try {
      await this.redisService.set(
        instanceKey,
        JSON.stringify(instanceData),
        Math.ceil(this.INSTANCE_TTL_MS / 1000)
      );
      this.logger.log(`Registered rate limiting instance: ${instanceId}`);

      // Start heartbeat interval
      this.startHeartbeat(instanceId, instanceKey);
    } catch (error) {
      this.logger.log('Failed to register instance, running in standalone mode');
      this.redisAvailable = false;
    }
  }

  private generateInstanceId(): string {
    const hostname = os.hostname();
    const pid = process.pid;
    const timestamp = Date.now();
    return `${hostname}:${pid}:${timestamp}`;
  }

  private startHeartbeat(instanceId: string, instanceKey: string): void {
    setInterval(async () => {
      try {
        const heartbeatData = {
          id: instanceId,
          lastHeartbeat: Date.now(),
          hostname: os.hostname(),
          pid: process.pid,
        };
        await this.redisService.set(
          instanceKey,
          JSON.stringify(heartbeatData),
          Math.ceil(this.INSTANCE_TTL_MS / 1000)
        );
      } catch (error) {
        if (this.redisAvailable) {
          this.logger.error('Failed to send heartbeat:', error);
        }
      }
    }, this.INSTANCE_HEARTBEAT_INTERVAL);
  }

  private async getActiveInstances(): Promise<string[]> {
    try {
      const pattern = 'rate-limit:instances:*';
      // Note: In production, use SCAN instead of KEYS for better performance
      const keys = await this.redisService.keys?.(pattern) || [];
      return keys;
    } catch (error) {
      if (this.redisAvailable) {
        this.logger.error('Failed to get active instances:', error);
      }
      return [];
    }
  }

  // Circuit breaker methods
  private checkCircuitBreaker(): boolean {
    // If Redis is not available, always return true to indicate circuit breaker is open
    if (!this.redisAvailable) {
      return true;
    }

    if (this.circuitBreakerOpen) {
      const now = Date.now();
      if (now - this.circuitBreakerOpenedAt >= this.CIRCUIT_BREAKER_RESET_MS) {
        // Reset circuit breaker after reset period
        this.logger.log('Circuit breaker resetting');
        this.circuitBreakerOpen = false;
        this.redisFailureCount = 0;
        return false;
      }
      return true; // Circuit breaker is open
    }
    return false; // Circuit breaker is closed
  }

  private recordRedisFailure(): void {
    // Don't record failures if Redis is intentionally disabled
    if (!this.redisAvailable) {
      return;
    }

    this.redisFailureCount++;
    if (this.redisFailureCount >= this.CIRCUIT_BREAKER_THRESHOLD && !this.circuitBreakerOpen) {
      this.circuitBreakerOpen = true;
      this.circuitBreakerOpenedAt = Date.now();
      this.logger.warn(`Circuit breaker opened after ${this.redisFailureCount} failures`);
    }
  }

  private recordRedisSuccess(): void {
    // Don't record successes if Redis is intentionally disabled
    if (!this.redisAvailable) {
      return;
    }

    this.redisFailureCount = Math.max(0, this.redisFailureCount - 1);
  }

  private validateOptions(options: RateLimitOptions): void {
    // Validate basic options
    if (options.requests <= 0) {
      throw new Error('Rate limit requests must be greater than 0');
    }
    if (options.windowMs <= 0) {
      throw new Error('Rate limit windowMs must be greater than 0');
    }

    // Validate burst configuration if provided
    if (options.burstLimit !== undefined) {
      if (options.burstLimit < 0) {
        throw new Error('Burst limit must be greater than or equal to 0');
      }
      if (options.burstWindowMs !== undefined && options.burstWindowMs <= 0) {
        throw new Error('Burst window must be greater than 0');
      }
    }

    // Validate adaptive limits if provided
    if (options.adaptiveLimits) {
      for (const limit of options.adaptiveLimits) {
        if (limit.requests <= 0) {
          throw new Error('Adaptive limit requests must be greater than 0');
        }
      }
    }

    // Validate premium multiplier
    if (options.premiumMultiplier !== undefined && options.premiumMultiplier < 1) {
      throw new Error('Premium multiplier must be greater than or equal to 1');
    }

    // Validate load threshold
    if (options.loadThreshold !== undefined && (options.loadThreshold <= 0 || options.loadThreshold > 1)) {
      throw new Error('Load threshold must be between 0 and 1');
    }
  }

  private getGlobalWhitelist(): { ips?: string[], userIds?: string[] } {
    const ips = this.configService.get<string>('RATE_LIMIT_WHITELIST_IPS');
    const userIds = this.configService.get<string>('RATE_LIMIT_WHITELIST_USER_IDS');
    return {
      ips: ips?.split(',').map(ip => ip.trim()).filter(ip => ip.length > 0),
      userIds: userIds?.split(',').map(id => id.trim()).filter(id => id.length > 0),
    };
  }

  private isWhitelisted(req: Request, whitelist?: RateLimitOptions['whitelist']): boolean {
    const globalWhitelist = this.getGlobalWhitelist();
    const mergedWhitelist = {
      ips: [...(globalWhitelist.ips || []), ...(whitelist?.ips || [])],
      userIds: [...(globalWhitelist.userIds || []), ...(whitelist?.userIds || [])],
    };

    if (mergedWhitelist.ips.length === 0 && mergedWhitelist.userIds.length === 0) {
      return false;
    }

    const clientIp = req.ip || (req as any).connection?.remoteAddress || 'unknown';
    // Check IP whitelist
    if (mergedWhitelist.ips.includes(clientIp)) {
      this.logSecurityEvent('info', `IP ${clientIp} is whitelisted`, req);
      return true;
    }

    // Check user ID whitelist
    const user = (req as any).user;
    if (user && user.userId) {
      const userId = user.userId;
      if (mergedWhitelist.userIds.includes(userId)) {
        this.logSecurityEvent('info', `User ${userId} is whitelisted`, req);
        return true;
      }
    }

    return false;
  }

  private getAdaptiveLimit(req: Request, options: RateLimitOptions): number {
    // Start with base limit
    let limit = options.requests;

    // Adaptive limits based on role/tier
    if (options.adaptiveLimits && options.adaptiveLimits.length > 0) {
      const user = (req as any).user;
      if (user) {
        const roleName = user.role;
        if (roleName) {
          const roleLimit = options.adaptiveLimits.find(limit => limit.role === roleName);
          if (roleLimit) limit = roleLimit.requests;
        }
        const tier = user.tier;
        if (tier) {
          const tierLimit = options.adaptiveLimits.find(limit => limit.tier === tier);
          if (tierLimit) limit = tierLimit.requests;
        }
      }
    }

    return limit;
  }

  private isPremiumUser(req: Request): boolean {
    const user = (req as any).user;
    if (!user) return false;

    // Check tier
    if (user.tier === 'premium' || user.tier === 'enterprise') {
      return true;
    }

    // Check role
    if (user.role === 'premium' || user.role === 'admin') {
      return true;
    }

    // Check permissions array
    if (Array.isArray(user.permissions)) {
      if (user.permissions.includes('premium_access') || user.permissions.includes('unlimited_requests')) {
        return true;
      }
    }

    // Check custom flag
    if (user.isPremium === true) {
      return true;
    }

    return false;
  }

  private getRegion(req: Request): string {
    // Try to get region from header
    const regionHeader = req.headers['x-region'] || req.headers['cf-ipcountry'];
    if (regionHeader && typeof regionHeader === 'string') {
      return regionHeader.toLowerCase();
    }

    // Alternatively, could use geoIP service (not implemented here)
    // Default region
    return 'global';
  }

  private getApiKey(req: Request, headerName: string = 'x-api-key'): string | null {
    const apiKey = req.headers[headerName];
    if (apiKey && typeof apiKey === 'string') {
      return apiKey.trim();
    }
    return null;
  }

  private getLoadAdjustmentFactor(loadThreshold?: number): number {
    // Get system load average (1 minute)
    const load = os.loadavg()[0];
    const cpuCount = os.cpus().length;
    const normalizedLoad = load / cpuCount;

    // Determine threshold: use provided threshold, then config service, then default 0.8
    const threshold = loadThreshold ?? this.configService.get<number>('RATE_LIMIT_LOAD_THRESHOLD', 0.8);
    if (normalizedLoad > threshold) {
      // Reduce limit by 50% when load exceeds threshold
      return 0.5;
    }
    return 1.0;
  }

  private computeEffectiveLimits(req: Request, options: RateLimitOptions): { requests: number, windowMs: number } {
    // Start with adaptive limit based on role/tier
    let requests = this.getAdaptiveLimit(req, options);
    let windowMs = options.windowMs;

    let requestsOverridden = false;
    let windowMsOverridden = false;

    // Region-specific limits (override both requests and windowMs)
    if (options.regions) {
      const region = this.getRegion(req);
      const regionLimit = options.regions[region];
      if (regionLimit) {
        requests = regionLimit.requests;
        windowMs = regionLimit.windowMs;
        requestsOverridden = true;
        windowMsOverridden = true;
      }
    }

    // API key specific limit (override both requests and windowMs, takes precedence over region)
    const apiKeyHeader = options.apiKeyHeader || 'x-api-key';
    const apiKey = this.getApiKey(req, apiKeyHeader);
    if (apiKey && options.apiKeyLimit) {
      requests = options.apiKeyLimit.requests;
      windowMs = options.apiKeyLimit.windowMs;
      requestsOverridden = true;
      windowMsOverridden = true;
    }

    // Premium multiplier (only apply if requests haven't been overridden by region/API key)
    if (this.isPremiumUser(req) && options.premiumMultiplier && !requestsOverridden) {
      requests = Math.floor(requests * options.premiumMultiplier);
    }

    // Grace period for premium users (add to windowMs regardless of overrides)
    if (this.isPremiumUser(req) && options.gracePeriodMs) {
      windowMs += options.gracePeriodMs;
    }

    // Dynamic adjustment based on system load (always apply to final requests)
    if (options.dynamicAdjustment) {
      const factor = this.getLoadAdjustmentFactor(options.loadThreshold);
      requests = Math.floor(requests * factor);
      // Ensure at least 1 request allowed
      if (requests < 1) requests = 1;
    }

    return { requests, windowMs };
  }

  private async applyBurstDetection(
    req: Request,
    options: RateLimitOptions,
    clientId: string
  ): Promise<{ blocked: boolean; message?: string }> {
    if (!options.burstLimit || options.burstLimit <= 0) {
      return { blocked: false };
    }

    // Check circuit breaker first
    if (this.checkCircuitBreaker()) {
      this.logger.warn('Circuit breaker is open, skipping burst detection');
      return { blocked: false };
    }

    const burstWindowMs = options.burstWindowMs || 1000; // Default 1 second
    const burstKey = `burst:zset:${clientId}`;
    const now = Date.now();
    const windowStart = now - burstWindowMs;
    const uniqueId = `${now}:${Math.random().toString(36).substring(2)}`;

    try {
      // Lua script for atomic burst detection using Redis ZSET
      const luaScript = `
        local key = KEYS[1]
        local now = tonumber(ARGV[1])
        local window = tonumber(ARGV[2])
        local maxRequests = tonumber(ARGV[3])
        local member = ARGV[4]
        local cutoff = now - window

        -- Clean old entries
        redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)

        -- Count current entries in window
        local count = redis.call('ZCOUNT', key, cutoff, now)

        if count < maxRequests then
          -- Add new entry
          redis.call('ZADD', key, now, member)
          -- Set expiry slightly longer than window
          redis.call('EXPIRE', key, math.ceil((window + 1000) / 1000))
          return {0}  -- 0 = not blocked
        else
          return {1}  -- 1 = blocked
        end
      `;

      const result = await this.redisService.eval<[number]>(luaScript, 1, burstKey, now, burstWindowMs, options.burstLimit, uniqueId);
      const blocked = result[0] === 1;

      if (blocked) {
        return {
          blocked: true,
          message: `Burst limit exceeded. Maximum ${options.burstLimit} requests per ${burstWindowMs}ms allowed.`,
        };
      }

      // Record Redis success for circuit breaker
      this.recordRedisSuccess();

      return { blocked: false };
    } catch (error) {
      // Record Redis failure for circuit breaker
      this.recordRedisFailure();

      // If Redis is not available, fail open silently
      if (!this.redisAvailable) {
        return { blocked: false };
      }

      this.logger.error('Burst detection error:', error);
      // Fail open - allow request through if burst detection fails
      return { blocked: false };
    }
  }

  private logSecurityEvent(
    level: 'info' | 'warn' | 'error',
    message: string,
    req: Request,
    data?: any
  ) {
    const clientId = this.getClientIdentifier(req);
    const logMessage = `[RateLimit Security] ${message} - Client: ${clientId} - Path: ${req.method} ${req.path}`;

    if (level === 'info') {
      this.logger.log(logMessage, data);
    } else if (level === 'warn') {
      this.logger.warn(logMessage, data);
    } else {
      this.logger.error(logMessage, data);
    }
  }

  async use(req: Request, res: Response, next: NextFunction) {
    // Check if rate limiting is configured for this route
    let rateLimitConfig = null;

    try {
      // Try to get rate limit config from route handler
      if (req.route?.stack && Array.isArray(req.route.stack) && req.route.stack.length > 0) {
        const lastHandler = req.route.stack[req.route.stack.length - 1];
        if (lastHandler?.handle) {
          rateLimitConfig = Reflect.getMetadata('rateLimit', lastHandler.handle);
        }
      }

      // If not found in route handler, try to get from request handler directly
      if (!rateLimitConfig && (req as any).handler) {
        rateLimitConfig = Reflect.getMetadata('rateLimit', (req as any).handler);
      }
    } catch (error: unknown) {
      // If there's an error accessing metadata, proceed without rate limiting
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn('Error accessing rate limit metadata, proceeding without rate limiting:', errorMessage);
      return next();
    }

    if (!rateLimitConfig) {
      // No rate limiting configured, proceed normally
      return next();
    }

    // Validate configuration
    try {
      this.validateOptions(rateLimitConfig);
    } catch (error) {
      this.logger.error('Invalid rate limit configuration:', error);
      // Fail open - allow request through if configuration is invalid
      return next();
    }

    // Check whitelist first
    if (this.isWhitelisted(req, rateLimitConfig.whitelist)) {
      return next();
    }

    // Compute effective limits considering business factors
    const effectiveLimits = this.computeEffectiveLimits(req, rateLimitConfig);

    try {
      // Apply sliding window rate limit with effective limits
      const slidingWindowResult = await this.applySlidingWindowRateLimit(req, res, {
        ...rateLimitConfig,
        requests: effectiveLimits.requests,
        windowMs: effectiveLimits.windowMs,
      });

      if (slidingWindowResult.blocked) {
        this.logSecurityEvent('warn', 'Rate limit exceeded', req, {
          limit: effectiveLimits.requests,
          clientId: this.getClientIdentifier(req),
        });
        res.status(HttpStatus.TOO_MANY_REQUESTS).json({
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: slidingWindowResult.message || 'Too many requests, please try again later',
          error: 'Too Many Requests',
        });
        return;
      }

      // Apply burst detection
      const burstResult = await this.applyBurstDetection(req, rateLimitConfig, this.getClientIdentifier(req));
      if (burstResult.blocked) {
        this.logSecurityEvent('warn', 'Burst limit exceeded', req, {
          burstLimit: rateLimitConfig.burstLimit,
          burstWindowMs: rateLimitConfig.burstWindowMs || 1000,
        });
        res.status(HttpStatus.TOO_MANY_REQUESTS).json({
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: burstResult.message || 'Too many requests, please try again later',
          error: 'Too Many Requests',
        });
        return;
      }

      // Log successful request if logging enabled
      if (rateLimitConfig.enableLogging && rateLimitConfig.logLevel === 'info') {
        this.logSecurityEvent('info', 'Request allowed', req, {
          limit: effectiveLimits.requests,
          burstLimit: rateLimitConfig.burstLimit,
        });
      }

    } catch (error) {
      if (this.redisAvailable) {
        this.logger.error('Rate limiting error:', error);
      }
      // Fail open - allow request through if rate limiting fails
      return next();
    }

    next();
  }

  private async applySlidingWindowRateLimit(
    req: Request,
    res: Response,
    options: RateLimitOptions
  ): Promise<{ blocked: boolean; message?: string }> {
    const {
      requests,
      windowMs,
      keyPrefix = 'rate-limit',
      errorMessage = 'Too many requests, please try again later',
    } = options;

    // Generate key based on IP and optional user ID
    const clientId = this.getClientIdentifier(req);
    const key = `${keyPrefix}:${clientId}`;

    const now = Date.now();
    const windowSec = Math.ceil(windowMs / 1000);
    const uniqueId = `${now}:${Math.random().toString(36).substring(2)}`;

    // Check circuit breaker first
    if (this.checkCircuitBreaker()) {
      this.logger.warn('Circuit breaker is open, using local sliding window');
      return this.applyLocalSlidingWindowRateLimit(req, res, options);
    }

    // Optimized Lua script for atomic sliding window rate limiting
    // Uses pipeline for better performance and minimizes round trips
    const luaScript = `
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local window = tonumber(ARGV[2])
      local maxRequests = tonumber(ARGV[3])
      local member = ARGV[4]
      local windowSec = math.ceil(window / 1000)
      local cutoff = now - window

      -- Pipeline operations for better performance
      redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)
      local count = redis.call('ZCOUNT', key, cutoff, now)

      if count < maxRequests then
        redis.call('ZADD', key, now, member)
        redis.call('EXPIRE', key, windowSec)

        -- Calculate reset time from oldest entry if exists
        local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
        local resetTime = now + window
        if oldest[2] then
          resetTime = tonumber(oldest[2]) + window
        end
        return {count, maxRequests - count - 1, resetTime}
      else
        -- Request would exceed limit, don't add member
        local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
        local resetTime = now + window
        if oldest[2] then
          resetTime = tonumber(oldest[2]) + window
        end
        return {count, 0, resetTime}
      end
    `;

    try {
      // Try Redis-based sliding window first with timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Redis timeout')), this.REDIS_TIMEOUT_MS);
      });

      const result = await Promise.race([
        this.redisService.eval<[number, number, number]>(luaScript, 1, key, now, windowMs, requests, uniqueId),
        timeoutPromise
      ]);

      const [count, remaining, resetTime] = result;

      // Record Redis success for circuit breaker
      this.recordRedisSuccess();

      // If at or over the limit, block the request
      if (remaining < 0) {
        return { blocked: true, message: errorMessage };
      }

      // Add rate limit headers
      this.addRateLimitHeaders(res, remaining, requests, resetTime - now);

      return { blocked: false };
    } catch (error) {
      // Record Redis failure for circuit breaker
      this.recordRedisFailure();

      // If Redis is not available, fail open silently
      if (!this.redisAvailable) {
        // Fallback to local sliding window when Redis is unavailable
        return this.applyLocalSlidingWindowRateLimit(req, res, options);
      }

      this.logger.error(`Redis rate limiting error (timeout or other), falling back to local sliding window: ${error instanceof Error ? error.message : String(error)}`);
      // Fallback to local sliding window when Redis is unavailable or times out
      return this.applyLocalSlidingWindowRateLimit(req, res, options);
    }
  }

  private async applyLocalSlidingWindowRateLimit(
    req: Request,
    res: Response,
    options: RateLimitOptions
  ): Promise<{ blocked: boolean; message?: string }> {
    const {
      requests,
      windowMs,
      errorMessage = 'Too many requests, please try again later',
    } = options;

    const clientId = this.getClientIdentifier(req);
    const now = Date.now();
    const windowStart = now - windowMs;

    // Local cache: Map from key to array of timestamps
    if (!this.localRateLimitCache) {
      this.localRateLimitCache = new Map<string, number[]>();
    }

    const cache = this.localRateLimitCache;
    const timestamps = cache.get(clientId) || [];

    // Remove timestamps older than the window
    const validTimestamps = timestamps.filter(ts => ts > windowStart);

    // Check if limit exceeded
    if (validTimestamps.length >= requests) {
      // Calculate reset time (oldest timestamp + windowMs)
      const oldest = Math.min(...validTimestamps);
      const resetTime = oldest + windowMs;
      this.addRateLimitHeaders(res, 0, requests, resetTime - now);
      return { blocked: true, message: errorMessage };
    }

    // Add current timestamp
    validTimestamps.push(now);
    cache.set(clientId, validTimestamps);

    // Cleanup: remove entries older than window to prevent memory leak
    setTimeout(() => {
      const currentTimestamps = cache.get(clientId);
      if (currentTimestamps) {
        const updated = currentTimestamps.filter(ts => ts > now - windowMs);
        if (updated.length === 0) {
          cache.delete(clientId);
        } else {
          cache.set(clientId, updated);
        }
      }
    }, windowMs + 1000); // Schedule cleanup after window expires

    // Calculate remaining requests and reset time
    const remaining = requests - validTimestamps.length;
    const oldest = validTimestamps.length > 0 ? Math.min(...validTimestamps) : now;
    const resetTime = oldest + windowMs;
    this.addRateLimitHeaders(res, remaining, requests, resetTime - now);

    return { blocked: false };
  }

  private getClientIdentifier(req: Request): string {
    // Use the improved rate limit key generator
    return this.rateLimitKeyGenerator.generateKey(req);
  }

  private addRateLimitHeaders(
    res: Response,
    remaining: number,
    limit: number,
    resetInMs: number
  ): void {
    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, remaining));
    res.setHeader('X-RateLimit-Reset', new Date(Date.now() + resetInMs).toISOString());
  }
}