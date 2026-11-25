import { Global, Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { redisConfig } from '../config';
import Redis from 'ioredis';

import { REDIS_CLIENT } from './redis.constants';
import { ThrottleStorage } from '../common/throttling/throttle-storage';
import { RedisThrottleStorage } from './redis-throttle.storage';
import { RedisService } from './redis.service';

@Global()
@Module({
  imports: [ConfigModule.forFeature(redisConfig)],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [redisConfig.KEY],
      useFactory: (config: ConfigType<typeof redisConfig>) => {
        const redisUrl = config.url;
        const url = new URL(redisUrl);

        // Check if it's a secure connection (rediss://)
        const isSecure = redisUrl.startsWith('rediss://');

        return new Redis({
          host: url.hostname,
          port: parseInt(url.port) || (isSecure ? 6379 : 6379),
          username: url.username || undefined,
          password: url.password || undefined,
          db: parseInt(url.pathname.slice(1)) || 0,
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          // Connection pooling optimizations
          connectTimeout: 10000,
          lazyConnect: false,
          keepAlive: 10000,
          // TLS configuration for secure connections
          tls: isSecure ? {} : undefined,
          // Performance optimizations
          enableOfflineQueue: true,
          enableAutoPipelining: true,
          autoPipeliningIgnoredCommands: ['multi', 'exec', 'eval', 'evalsha'],
          // Retry strategy
          retryStrategy: (times: number) => {
            const delay = Math.min(times * 100, 3000);
            return delay;
          },
        });
      },
    },
    RedisService,
    RedisThrottleStorage,
    { provide: ThrottleStorage, useExisting: RedisThrottleStorage },
  ],
  exports: [RedisService, ThrottleStorage],
})
export class RedisModule {}
