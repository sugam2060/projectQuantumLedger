import { Inject, Injectable } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { RequestContextService } from './request_context.service';

type DrizzleDatabase = ReturnType<typeof drizzle<typeof schema>>;
type DrizzleTransaction = Parameters<
  DrizzleDatabase['transaction']
>[0] extends (transaction: infer TTransaction) => Promise<unknown>
  ? TTransaction
  : never;
type TransactionConfig = Parameters<DrizzleDatabase['transaction']>[1];

@Injectable()
export class DatabaseService {
  constructor(
    @Inject(getDrizzleToken())
    private readonly database: DrizzleDatabase,
    private readonly contextService: RequestContextService,
  ) {}

  get $client(): Pool {
    return this.database.$client;
  }

  get query(): DrizzleDatabase['query'] {
    return this.database.query;
  }

  get select(): DrizzleDatabase['select'] {
    return this.database.select.bind(this.database);
  }

  get insert(): DrizzleDatabase['insert'] {
    return this.database.insert.bind(this.database);
  }

  get update(): DrizzleDatabase['update'] {
    return this.database.update.bind(this.database);
  }

  get delete(): DrizzleDatabase['delete'] {
    return this.database.delete.bind(this.database);
  }

  get execute(): DrizzleDatabase['execute'] {
    return this.database.execute.bind(this.database);
  }

  transaction<T>(
    callback: (transaction: DrizzleTransaction) => Promise<T>,
    config?: TransactionConfig,
  ): Promise<T> {
    const session = this.contextService.getSession();

    return this.database.transaction(async (transaction) => {
      await transaction.execute(sql`
        SELECT
          set_config('app.business_id', ${session.businessId ?? ''}, true),
          set_config('app.user_id', ${session.userId ?? ''}, true),
          set_config('app.branch_id', ${session.branchId ?? ''}, true),
          set_config('app.platform_user_id', ${session.platformUserId ?? ''}, true),
          set_config('app.is_platform_user', ${session.isPlatform ? 'true' : 'false'}, true),
          set_config('app.is_owner', ${session.isOwner ? 'true' : 'false'}, true);
      `);

      return callback(transaction);
    }, config);
  }
}
