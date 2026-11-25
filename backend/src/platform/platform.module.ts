import { AuditLogsModule } from '../audit-logs';
import { ConfigModule } from '@nestjs/config';
import { appConfig } from '../config';
import { Module } from '@nestjs/common';
import { UtilsModule } from '../utils/utils.module';
import { PlatformBusinessesController } from './platform-businesses.controller';
import { PlatformBusinessesService } from './platform-businesses.service';
import { MailOutboxPublisher } from './mail-outbox.publisher';
import { RedisModule } from '../redis/redis.module';
import { PlatformUsersController } from './platform-users.controller';
import { PlatformUsersService } from './platform-users.service';

@Module({
  imports: [
    AuditLogsModule,
    ConfigModule.forFeature(appConfig),
    UtilsModule,
    RedisModule,
  ],
  controllers: [PlatformBusinessesController, PlatformUsersController],
  providers: [
    PlatformBusinessesService,
    PlatformUsersService,
    MailOutboxPublisher,
  ],
})
export class PlatformModule {}
