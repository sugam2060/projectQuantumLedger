import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthenticationModule } from './authentication/authentication.module';
import { AuthorizationModule, PermissionGuard } from './authorization';
import { BusinessesModule } from './businesses';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { ThrottleGuard } from './common/guards/throttle.guard';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import {
  THROTTLER_SETTINGS,
  type ThrottlerSettings,
} from './common/throttling/throttling.constants';
import { appConfig, mailConfig, throttleConfig, validateEnv } from './config';
import { DatabaseModule } from './database/database.module';
import { QueueModule } from './jobs';
import { PlatformModule } from './platform/platform.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: validateEnv,
      load: [appConfig, throttleConfig, mailConfig],
    }),
    DatabaseModule,
    QueueModule,
    AuthenticationModule,
    RedisModule,
    AuthorizationModule,
    PlatformModule,
    BusinessesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: THROTTLER_SETTINGS,
      inject: [throttleConfig.KEY],
      useFactory: (
        config: ConfigType<typeof throttleConfig>,
      ): ThrottlerSettings => ({
        ttlMs: config.ttlMs,
        limit: config.limit,
        authLimit: config.authLimit,
      }),
    },
    // Global guards run in registration order, and the order is behaviour:
    // 1. ThrottleGuard rejects floods before any authentication work is done.
    // 2. JwtAuthGuard authenticates (skipped by @Public()) and sets request.user.
    // 3. PermissionGuard must stay last: it reads request.user set by step 2 and
    //    checks @RequiredPermission / @RequiredPlatformPermission.
    { provide: APP_GUARD, useClass: ThrottleGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Runs before guards so every response, including 401/429, carries a request id.
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
