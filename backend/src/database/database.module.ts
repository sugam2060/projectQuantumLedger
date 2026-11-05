import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DrizzleModule, getDrizzleToken } from '@nestjs/drizzle';
import { createDatabaseOptions } from './database.provider';
import { DatabaseService } from './database.service';

@Module({
  imports: [
    DrizzleModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: createDatabaseOptions,
    }),
  ],
  providers: [
    {
      provide: DatabaseService,
      useFactory: (database: DatabaseService) => database,
      inject: [getDrizzleToken()],
    },
  ],
  exports: [DatabaseService, DrizzleModule],
})
export class DatabaseModule {}
