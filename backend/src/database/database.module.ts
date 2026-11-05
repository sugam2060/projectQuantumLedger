import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DrizzleModule } from '@nestjs/drizzle';
import { createDatabaseOptions } from './database.provider';
import { DatabaseService } from './database.service';
import { RequestContextService } from './request_context.service';
import { RlsContextInterceptor } from './rls_context.interceptor';

@Global()
@Module({
  imports: [
    DrizzleModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: createDatabaseOptions,
    }),
  ],
  providers: [
    RequestContextService,
    DatabaseService,
    {
      provide: APP_INTERCEPTOR,
      useClass: RlsContextInterceptor,
    },
  ],
  exports: [DatabaseService, DrizzleModule],
})
export class DatabaseModule {}
