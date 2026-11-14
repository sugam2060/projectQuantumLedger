import { Module } from '@nestjs/common';
import { UtilsModule } from '../utils/utils.module';
import { PlatformBusinessController } from './platform-business.controller';
import { PlatformBusinessService } from './platform-business.service';

@Module({
  imports: [UtilsModule],
  controllers: [PlatformBusinessController],
  providers: [PlatformBusinessService],
})
export class PlatformBusinessModule {}
