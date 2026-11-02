import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { DatabaseModule } from '../database/database.module';
import { RedisModule } from '../redis/redis.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthSessionService } from './auth-session.service';
import { AccessControlGuard } from './guards/access-control.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LoginRateLimitMiddleware } from './middleware/login-rate-limit.middleware';
import { ClientTypePipe } from './pipes/client-type.pipe';
import { JwtStrategy } from './strategies/jwt.strategy';
import { ACCESS_TOKEN_TTL_SECONDS } from './auth.constants';

@Module({
  imports: [
    DatabaseModule,
    RedisModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const secret = configService.getOrThrow<string>('JWT_SECRET');
        if (Buffer.byteLength(secret, 'utf8') < 32) {
          throw new Error('JWT_SECRET must be at least 32 bytes');
        }

        return {
          secret,
          signOptions: {
            algorithm: 'HS256',
            expiresIn: ACCESS_TOKEN_TTL_SECONDS,
            issuer: 'quantum-ledger',
            audience: 'quantum-ledger-api',
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthSessionService,
    AccessControlGuard,
    ClientTypePipe,
    JwtAuthGuard,
    JwtStrategy,
  ],
  exports: [
    AccessControlGuard,
    AuthService,
    AuthSessionService,
    JwtAuthGuard,
    JwtModule,
    PassportModule,
  ],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(LoginRateLimitMiddleware)
      .forRoutes({ path: 'auth/login', method: RequestMethod.POST });
  }
}
