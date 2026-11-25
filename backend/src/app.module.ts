import { Module, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { appConfig, validateEnv } from './config';
import { DatabaseModule } from './database/database.module';
import { AuthenticationModule } from './authentication/authentication.module';
import { UtilsModule } from './utils/utils.module';
import { RedisModule } from './redis/redis.module';
import { RolesPermissionsModule } from './roles-permissions/roles-permissions.module';
import { PlatformBusinessModule } from './platform-business/platform-business.module';
import { BusinessModule } from './business/business.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionGuard } from './authentication/guards/permission.guard';
import { RateLimitGuard } from './authentication/guards/rate-limit.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: validateEnv,
      load: [appConfig],
    }),
    DatabaseModule,
    AuthenticationModule,
    UtilsModule,
    RedisModule,
    RolesPermissionsModule,
    PlatformBusinessModule,
    BusinessModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_PIPE,
      useFactory: () =>
        new ValidationPipe({
          whitelist: true,
          transform: true,
          validateCustomDecorators: true,
        }),
    },
    // Global guards run in registration order, and the order is behaviour:
    // 1. JwtAuthGuard authenticates (skipped by @Public()) and sets request.user.
    // 2. RateLimitGuard applies per-route @RateLimit() limits.
    // 3. PermissionGuard must stay last: it reads request.user set by step 1.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class AppModule {}
