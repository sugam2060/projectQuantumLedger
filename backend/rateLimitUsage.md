# Rate Limit Decorator Usage Guide

This guide explains how to implement and use the `@RateLimit` decorator in your NestJS endpoints for comprehensive rate limiting.

## Table of Contents
1. [Basic Setup](#basic-setup)
2. [Simple Rate Limiting](#simple-rate-limiting)
3. [Advanced Rate Limiting](#advanced-rate-limiting)
4. [Security Features](#security-features)
5. [Business Considerations](#business-considerations)
6. [Configuration Examples](#configuration-examples)

## Basic Setup

First, ensure the rate limiting middleware is properly configured in your application:

```typescript
// In main.ts or bootstrap
import { NestFactory } from '@nestjs/core';
import { RateLimitMiddleware } from './utils/ratelimit.middleware';
import { RedisService } from './redis/redis.service';
import { RateLimitKeyGenerator } from './utils/rate-limit-key.generator';
import { RateLimitMiddleware } from './utils/ratelimit.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Resolve dependencies and add rate limiting middleware
  const redisService = app.get(RedisService);
  const configService = app.get(ConfigService);
  const rateLimitKeyGenerator = app.get(RateLimitKeyGenerator);

  app.use(new RateLimitMiddleware(
    redisService,
    configService,
    rateLimitKeyGenerator
  ));
  
  await app.listen(3000);
}
```

Then import the decorator in your controller:

```typescript
import { RateLimit } from '../authentication/decorators/rate-limit.decorator';
```

## Simple Rate Limiting

### Basic Usage
```typescript
@Controller('api')
export class ApiController {
  @Get('public-data')
  @Public()
  @RateLimit({ 
    requests: 100, 
    windowMs: 60000 // 100 requests per minute
  })
  getPublicData() {
    return { data: 'public information' };
  }
}
```

### Authenticated Endpoint
```typescript
@Controller('user')
export class UserController {
  @Get('profile')
  @RateLimit({ 
    requests: 1000, 
    windowMs: 3600000 // 1000 requests per hour
  })
  getProfile() {
    return { profile: 'user profile data' };
  }
}
```

## Advanced Rate Limiting

### Premium User Features
```typescript
@Controller('premium')
export class PremiumController {
  @Post('upload')
  @RateLimit({
    requests: 100,
    windowMs: 3600000, // 100 requests per hour
    // Premium users get double limits and 5 extra minutes
    premiumMultiplier: 2,
    gracePeriodMs: 300000, // 5 minutes extra for premium users
    // Dynamic adjustment based on system load
    dynamicAdjustment: true,
    loadThreshold: 0.8
  })
  uploadFile() {
    return { message: 'File uploaded successfully' };
  }
}
```

### Regional Distribution
```typescript
@Controller('content')
export class ContentController {
  @Get('localized')
  @RateLimit({
    requests: 1000,
    windowMs: 3600000,
    regions: {
      'us': { requests: 2000, windowMs: 3600000 },
      'eu': { requests: 1500, windowMs: 3600000 },
      'asia': { requests: 1000, windowMs: 3600000 }
    }
  })
  getLocalizedContent() {
    return { content: 'region-specific content' };
  }
}
```

### API Key Integration
```typescript
@Controller('integration')
export class IntegrationController {
  @Get('data')
  @Public()
  @RateLimit({
    requests: 10000,
    windowMs: 86400000, // 10,000 requests per day
    // Special limits for API keys
    apiKeyLimit: { requests: 50000, windowMs: 86400000 }, // 50,000 for API keys
    apiKeyHeader: 'x-api-key'
  })
  getIntegrationData() {
    return { data: 'integration data' };
  }
}
```

## Security Features

### Adaptive Rate Limits
```typescript
@Controller('admin')
export class AdminController {
  @Post('manage')
  @RateLimit({
    requests: 100,
    windowMs: 3600000,
    adaptiveLimits: [
      { role: 'admin', requests: 500 },
      { tier: 'enterprise', requests: 300 },
      { role: 'moderator', requests: 200 },
      { role: 'user', requests: 100 }
    ]
  })
  manageSystem() {
    return { message: 'System managed' };
  }
}
```

### Burst Detection
```typescript
@Controller('auth')
export class AuthController {
  @Post('login')
  @Public()
  @RateLimit({
    requests: 5,
    windowMs: 300000, // 5 requests per 5 minutes
    // Prevent rapid successive attempts
    burstLimit: 3, // Max 3 requests per second
    burstWindowMs: 1000
  })
  login() {
    return { message: 'Login attempt' };
  }
}
```

### Whitelisting
```typescript
@Controller('internal')
export class InternalController {
  @Get('stats')
  @RateLimit({
    requests: 1000,
    windowMs: 3600000,
    whitelist: {
      ips: ['127.0.0.1', '192.168.1.1', '10.0.0.1'],
      userIds: ['admin-user-123', 'service-account-456']
    }
  })
  getStats() {
    return { stats: 'internal statistics' };
  }
}
```

### Security Logging
```typescript
@Controller('sensitive')
export class SensitiveController {
  @Post('operation')
  @RateLimit({
    requests: 10,
    windowMs: 3600000,
    enableLogging: true,
    logLevel: 'info'
  })
  performSensitiveOperation() {
    return { message: 'Sensitive operation performed' };
  }
}
```

## Business Considerations

### Comprehensive Business-Oriented Rate Limiting
```typescript
@Controller('business-api')
export class BusinessApiController {
  @Post('process')
  @RateLimit({
    requests: 100,
    windowMs: 3600000,
    errorMessage: 'Too many business operations, please try again later',
    
    // Adaptive limits based on user roles/tiers
    adaptiveLimits: [
      { role: 'admin', requests: 500 },
      { tier: 'premium', requests: 300 },
      { role: 'business', requests: 200 },
      { role: 'user', requests: 100 }
    ],
    
    // Premium user features
    gracePeriodMs: 5000, // Extra 5 seconds for premium users
    premiumMultiplier: 2, // Double limit for premium users
    
    // Regional distribution
    regions: {
      'us': { requests: 200, windowMs: 3600000 },
      'eu': { requests: 150, windowMs: 3600000 },
      'asia': { requests: 100, windowMs: 3600000 }
    },
    
    // API key support
    apiKeyLimit: { requests: 1000, windowMs: 3600000 },
    apiKeyHeader: 'x-api-key',
    
    // Dynamic adjustment based on system load
    dynamicAdjustment: true,
    loadThreshold: 0.8, // 80% load threshold
    
    // Security enhancements
    burstLimit: 10, // Max 10 requests per second
    burstWindowMs: 1000,
    whitelist: {
      ips: ['127.0.0.1', '192.168.1.1'],
      userIds: ['trusted-user-id']
    },
    enableLogging: true,
    logLevel: 'info'
  })
  processBusinessData() {
    return { message: 'Business data processed' };
  }
}
```

## Configuration Examples

### Environment Variables
```bash
# .env file
RATE_LIMIT_WHITELIST_IPS=127.0.0.1,192.168.1.1
RATE_LIMIT_WHITELIST_USER_IDS=admin-user,trusted-service
RATE_LIMIT_LOAD_THRESHOLD=0.8
```

### Custom Configuration
```typescript
// For endpoints requiring special handling
@Controller('custom')
export class CustomController {
  @Get('special')
  @RateLimit({
    requests: 50,
    windowMs: 1800000, // 30 minutes
    keyPrefix: 'special-operation',
    errorMessage: 'Special operation limit reached',
    
    // Custom adaptive limits
    adaptiveLimits: [
      { 
        role: 'partner', 
        requests: 200,
        windowMs: 3600000 
      }
    ],
    
    // Custom burst protection
    burstLimit: 5,
    burstWindowMs: 2000,
    
    // Custom regional limits
    regions: {
      'production': { requests: 100, windowMs: 1800000 },
      'staging': { requests: 50, windowMs: 3600000 }
    }
  })
  specialOperation() {
    return { result: 'Special operation completed' };
  }
}
```

## Best Practices

1. **Start Conservative**: Begin with stricter limits and loosen as needed
2. **Monitor Usage**: Use logging to understand actual usage patterns
3. **Graceful Degradation**: Always implement fail-open behavior
4. **Regional Awareness**: Consider your global user base
5. **User Experience**: Provide clear error messages and rate limit headers
6. **Testing**: Test rate limiting behavior in staging environments
7. **Documentation**: Document rate limits for API consumers

## Response Headers

The rate limiting middleware automatically adds these headers to responses:
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Remaining requests in current window
- `X-RateLimit-Reset`: Timestamp when limit resets

## Error Responses

When rate limits are exceeded, the middleware returns:
```json
{
  "statusCode": 429,
  "message": "Too many requests, please try again later",
  "error": "Too Many Requests"
}
```

This comprehensive rate limiting system provides enterprise-grade protection while maintaining flexibility for different business needs and user tiers.

## Updated Main.ts Setup

Make sure your `main.ts` file includes the proper rate limiting middleware setup:

```typescript
// In main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from "@nestjs/config";
import { RedisService } from './redis/redis.service';
import { RateLimitKeyGenerator } from './utils/rate-limit-key.generator';
import { RateLimitMiddleware } from './utils/ratelimit.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Set global prefix
  app.setGlobalPrefix("/api/v1");

  // Resolve dependencies and add rate limiting middleware
  const redisService = app.get(RedisService);
  const configService = app.get(ConfigService);
  const rateLimitKeyGenerator = app.get(RateLimitKeyGenerator);

  app.use(new RateLimitMiddleware(
    redisService,
    configService,
    rateLimitKeyGenerator
  ));

  // Add global validation pipe
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true
  }));

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
```