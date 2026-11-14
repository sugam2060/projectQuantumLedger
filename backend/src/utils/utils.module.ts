import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UtilsService } from './utils.service';
import { RateLimitMiddleware } from './ratelimit.middleware';
import { ObjectStoreService } from './objectStore.service';
import { CloudinaryObjectStoreService } from './cloudinary.service';
import { RabbitMQService } from './rabbitmq.service';
import { createRabbitMQOptions, RABBITMQ_OPTIONS } from './rabbitmq.config';
import {
  RateLimitKeyGenerator,
  RateLimitKeyGeneratorOptions,
} from './rate-limit-key.generator';

@Module({
  imports: [ConfigModule],
  providers: [
    UtilsService,
    CloudinaryObjectStoreService,
    { provide: ObjectStoreService, useExisting: CloudinaryObjectStoreService },
    {
      provide: RABBITMQ_OPTIONS,
      inject: [ConfigService],
      useFactory: createRabbitMQOptions,
    },
    RabbitMQService,
    RateLimitMiddleware,
    {
      provide: RateLimitKeyGenerator,
      useFactory: () => {
        // Default options for RateLimitKeyGenerator
        const options: RateLimitKeyGeneratorOptions = {
          includeBusinessId: true,
          includeBranchId: false,
          deviceFingerprintHeader: 'X-Device-Fingerprint',
          regionHeader: 'X-Region',
          includeRegion: true,
          apiKeyHeader: 'X-API-Key',
          includeApiKey: true,
          hashKey: true,
        };
        return new RateLimitKeyGenerator();
      },
    },
  ],
  exports: [
    UtilsService,
    ObjectStoreService,
    CloudinaryObjectStoreService,
    RabbitMQService,
    RateLimitMiddleware,
    RateLimitKeyGenerator,
  ],
})
export class UtilsModule {}
