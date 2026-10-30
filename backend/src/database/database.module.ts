import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';

export const DATABASE = Symbol('DATABASE');
export const DATABASE_POOL = Symbol('DATABASE_POOL');

@Global()
@Module({
  providers: [
    DatabaseService,
    {
      provide: DATABASE_POOL,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) => database.pool,
    },
    {
      provide: DATABASE,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) => database.db,
    },
  ],
  exports: [DatabaseService, DATABASE, DATABASE_POOL],
})
export class DatabaseModule {}
