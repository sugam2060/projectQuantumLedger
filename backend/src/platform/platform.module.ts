import { AuthenticationModule } from '../authentication';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditLogsModule } from '../audit-logs';
import { appConfig } from '../config';
import { EmailModule } from '../jobs/email';
import { RedisModule } from '../redis/redis.module';
import { StorageModule } from '../storage';
import { BusinessRequestsController } from './business-requests.controller';
import { BusinessRequestsRepository } from './business-requests.repository';
import { BusinessRequestsService } from './business-requests.service';
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
    AuthenticationModule,
    ConfigModule.forFeature(appConfig),
    EmailModule,
    StorageModule,
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
  ],
})
export class PlatformModule {}
