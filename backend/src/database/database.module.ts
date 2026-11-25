import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DrizzleModule } from '@nestjs/drizzle';
import { databaseConfig } from '../config';
import { createDatabaseOptions } from './database.provider';
import { DatabaseService } from './database.service';

/** Pool + Drizzle client and DatabaseService. Global: repositories inject it. */
@Global()
@Module({
  imports: [
    DrizzleModule.forRootAsync({
      imports: [ConfigModule.forFeature(databaseConfig)],
      inject: [databaseConfig.KEY],
      useFactory: createDatabaseOptions,
    }),
  ],
  providers: [DatabaseService],
  exports: [DatabaseService, DrizzleModule],
})
export class DatabaseModule {}
