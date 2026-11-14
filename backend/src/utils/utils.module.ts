import { Module } from '@nestjs/common';
import { UtilsService } from './utils.service';
import { RateLimitMiddleware } from './ratelimit.middleware';
import { ObjectStoreService } from './objectStore.service';
import { CloudinaryObjectStoreService } from './cloudinary.service';
import {
  RateLimitKeyGenerator,
  RateLimitKeyGeneratorOptions,
} from './rate-limit-key.generator';

@Module({
  providers: [
    UtilsService,
    CloudinaryObjectStoreService,
    { provide: ObjectStoreService, useExisting: CloudinaryObjectStoreService },
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
    RateLimitMiddleware,
    RateLimitKeyGenerator,
  ],
})
export class UtilsModule {}
