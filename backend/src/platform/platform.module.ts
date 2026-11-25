import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditLogsModule } from '../audit-logs';
import { appConfig } from '../config';
import { RedisModule } from '../redis/redis.module';
import { StorageModule } from '../storage';
import { UtilsModule } from '../utils/utils.module';
import { BusinessRequestsController } from './business-requests.controller';
import { BusinessRequestsRepository } from './business-requests.repository';
import { BusinessRequestsService } from './business-requests.service';
import { MailOutboxPublisher } from './mail-outbox.publisher';
import { PlatformBusinessesController } from './platform-businesses.controller';
import { PlatformBusinessesRepository } from './platform-businesses.repository';
import { PlatformBusinessesService } from './platform-businesses.service';
import { PlatformUsersController } from './platform-users.controller';
import { PlatformUsersRepository } from './platform-users.repository';
import { PlatformUsersService } from './platform-users.service';

/** Fortis-staff side: business provisioning, public business requests, platform users. */
@Module({
  imports: [
    AuditLogsModule,
    ConfigModule.forFeature(appConfig),
    StorageModule,
    UtilsModule,
    RedisModule,
  ],
  controllers: [
    PlatformBusinessesController,
    BusinessRequestsController,
    PlatformUsersController,
  ],
  providers: [
    PlatformBusinessesRepository,
    PlatformBusinessesService,
    BusinessRequestsRepository,
    BusinessRequestsService,
    PlatformUsersRepository,
    PlatformUsersService,
    MailOutboxPublisher,
  ],
})
export class PlatformModule {}
