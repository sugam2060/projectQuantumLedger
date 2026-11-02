import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { databaseProviders, DATABASE, DATABASE_POOL } from './database.providers';

export { DATABASE, DATABASE_POOL };

@Global()
@Module({
  providers: [
    DatabaseService,
    ...databaseProviders,
  ],
  exports: [DatabaseService, DATABASE, DATABASE_POOL],
})
export class DatabaseModule {}
