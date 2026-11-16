import { Module } from '@nestjs/common';
import { UtilsModule } from '../utils/utils.module';
import { PlatformBusinessController } from './platform-business.controller';
import { PlatformBusinessService } from './platform-business.service';
import { MailOutboxPublisher } from './mail-outbox.publisher';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [UtilsModule, RedisModule],
  controllers: [PlatformBusinessController],
  providers: [PlatformBusinessService, MailOutboxPublisher],
})
export class PlatformBusinessModule {}
