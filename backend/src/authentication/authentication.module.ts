import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { authConfig } from '../config';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthenticationController } from './authentication.controller';
import { AuthenticationLogoutController } from './authentication-logout.controller';
import { AuthenticationPlatformController } from './authentication.platform.controller';
import { PlatformAuthService } from './authentication.service.platform';
import { UserAuthService } from './authentication.service.user';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionGuard } from './guards/permission.guard';
import { RateLimitGuard } from './guards/rate-limit.guard';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UtilsModule } from '../utils/utils.module';
import { RolesPermissionsModule } from '../roles-permissions/roles-permissions.module';

@Module({
  imports: [
    ConfigModule.forFeature(authConfig),
    UtilsModule,
    RolesPermissionsModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule.forFeature(authConfig)],
      inject: [authConfig.KEY],
      useFactory: (config: ConfigType<typeof authConfig>) => {
        const secret = config.jwtSecret;
        if (secret.length < 32) {
          throw new Error('JWT_SECRET must be at least 32 characters long');
        }

        return {
          secret,
          signOptions: { algorithm: 'HS256' as const, expiresIn: '15m' },
        };
      },
    }),
  ],
  controllers: [
    AuthenticationController,
    AuthenticationLogoutController,
    AuthenticationPlatformController,
  ],
  providers: [
    UserAuthService,
    PlatformAuthService,
    JwtStrategy,
    {
      provide: APP_PIPE,
      useFactory: () =>
        new ValidationPipe({
          whitelist: true,
          transform: true,
          validateCustomDecorators: true,
        }),
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionGuard,
    },
  ],
  exports: [JwtModule, PassportModule],
})
export class AuthenticationModule {}
