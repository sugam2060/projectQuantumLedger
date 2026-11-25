import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createRabbitMQOptions, RABBITMQ_OPTIONS } from './rabbitmq.config';
import { RabbitMQService } from './rabbitmq.service';
import { UtilsService } from './utils.service';

@Module({
  imports: [ConfigModule],
  providers: [
    UtilsService,
    {
      provide: RABBITMQ_OPTIONS,
      inject: [ConfigService],
      useFactory: createRabbitMQOptions,
    },
    RabbitMQService,
  ],
  exports: [UtilsService, RabbitMQService],
})
export class UtilsModule {}
