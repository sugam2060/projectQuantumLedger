import { Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuditLogsModule } from '../audit-logs';
import { appConfig, authConfig } from '../config';
import { RolesPermissionsModule } from '../roles-permissions/roles-permissions.module';
import { AuthCookieService } from './auth-cookie.service';
import { AuthenticationController } from './authentication.controller';
import { AuthenticationRepository } from './authentication.repository';
import { AuthenticationService } from './authentication.service';
import { PasswordService } from './password.service';
import { PlatformAuthenticationController } from './platform-authentication.controller';
import { PlatformAuthenticationRepository } from './platform-authentication.repository';
import { PlatformAuthenticationService } from './platform-authentication.service';
import { SessionsRepository } from './sessions.repository';
import { JwtStrategy } from './strategies/jwt.strategy';
import { PlatformJwtStrategy } from './strategies/platform-jwt.strategy';
import { TokenService } from './token.service';

/**
 * Sign-in for business users and Fortis staff: passwords, access tokens (two
 * audiences, two passport strategies), refresh sessions and the refresh cookie.
 */
@Module({
  imports: [
    ConfigModule.forFeature(authConfig),
    ConfigModule.forFeature(appConfig),
    AuditLogsModule,
    RolesPermissionsModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule.forFeature(authConfig)],
      inject: [authConfig.KEY],
      useFactory: (config: ConfigType<typeof authConfig>) => {
        if (config.jwtSecret.length < 32) {
          throw new Error(
            'JWT_ACCESS_SECRET must be at least 32 characters long',
          );
        }
        return {
          secret: config.jwtSecret,
          signOptions: { algorithm: 'HS256' as const },
          verifyOptions: { algorithms: ['HS256' as const] },
        };
      },
    }),
  ],
  controllers: [AuthenticationController, PlatformAuthenticationController],
  providers: [
    AuthenticationRepository,
    PlatformAuthenticationRepository,
    SessionsRepository,
    PasswordService,
    TokenService,
    AuthCookieService,
    AuthenticationService,
    PlatformAuthenticationService,
    JwtStrategy,
    PlatformJwtStrategy,
  ],
  exports: [PasswordService, SessionsRepository],
})
export class AuthenticationModule {}
