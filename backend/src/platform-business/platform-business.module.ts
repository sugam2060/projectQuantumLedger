import { Module } from '@nestjs/common';
import { UtilsModule } from '../utils/utils.module';
import { PlatformBusinessController } from './platform-business.controller';
import { PlatformBusinessService } from './platform-business.service';
import { MailOutboxPublisher } from './mail-outbox.publisher';
import { RedisModule } from '../redis/redis.module';
import { PlatformUsersController } from './platform-users.controller';
import { PlatformUserInvitationsService } from './platform-user-invitations.service';

@Module({
  imports: [UtilsModule, RedisModule],
  controllers: [PlatformBusinessController, PlatformUsersController],
  providers: [
    PlatformBusinessService,
    PlatformUserInvitationsService,
    MailOutboxPublisher,
  ],
})
export class PlatformBusinessModule {}
