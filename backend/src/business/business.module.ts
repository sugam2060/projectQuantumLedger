import { Module } from '@nestjs/common';
import { BusinessController } from './business.controller';
import { BusinessService } from './business.service';
import { UtilsModule } from '../utils/utils.module';
import { BusinessUtilsService } from './business.utils.service';

@Module({
  imports: [UtilsModule],
  controllers: [BusinessController],
  providers: [BusinessService, BusinessUtilsService],
})
export class BusinessModule {}
