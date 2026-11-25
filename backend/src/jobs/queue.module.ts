import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { redisConfig } from '../config';

/**
 * Shared BullMQ root: one Redis connection definition and default job retention for
 * every queue. Global, so queue modules only call `BullModule.registerQueue`.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule.forFeature(redisConfig)],
      inject: [redisConfig.KEY],
      useFactory: (config: ConfigType<typeof redisConfig>) => ({
        // Workers block on Redis, so ioredis must not give up on queued commands.
        connection: { url: config.url, maxRetriesPerRequest: null },
        defaultJobOptions: {
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 5000 },
        },
      }),
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
