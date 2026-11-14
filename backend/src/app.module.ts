import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { AuthenticationModule } from './authentication/authentication.module';
import { UtilsModule } from './utils/utils.module';
import { RedisModule } from './redis/redis.module';
import { RolesPermissionsModule } from './roles-permissions/roles-permissions.module';
import { PlatformBusinessModule } from './platform-business/platform-business.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    DatabaseModule,
    AuthenticationModule,
    UtilsModule,
    RedisModule,
    RolesPermissionsModule,
    PlatformBusinessModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
