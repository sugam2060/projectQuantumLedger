import { AuditLogsModule } from '../audit-logs';
import { Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { authConfig } from '../config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthenticationController } from './authentication.controller';
import { AuthenticationLogoutController } from './authentication-logout.controller';
import { PlatformAuthenticationController } from './platform-authentication.controller';
import { PlatformAuthenticationService } from './platform-authentication.service';
import { AuthenticationService } from './authentication.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UtilsModule } from '../utils/utils.module';
import { RolesPermissionsModule } from '../roles-permissions/roles-permissions.module';

@Module({
  imports: [
    AuditLogsModule,
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
    PlatformAuthenticationController,
  ],
  providers: [
    AuthenticationService,
    PlatformAuthenticationService,
    JwtStrategy,
  ],
  exports: [JwtModule, PassportModule],
})
export class AuthenticationModule {}
