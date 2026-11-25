import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { databaseConfig } from '../config';
import { DrizzleModule } from '@nestjs/drizzle';
import { createDatabaseOptions } from './database.provider';
import { DatabaseService } from './database.service';
import { RequestContextService } from './request_context.service';
import { RlsContextInterceptor } from './rls_context.interceptor';

@Global()
@Module({
  imports: [
    DrizzleModule.forRootAsync({
      imports: [ConfigModule.forFeature(databaseConfig)],
      inject: [databaseConfig.KEY],
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
