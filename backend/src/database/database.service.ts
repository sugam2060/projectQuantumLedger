import { Inject, Injectable } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import type { RequestSession } from './database.types';
import * as schema from './schemas';

type DrizzleDatabase = ReturnType<typeof drizzle<typeof schema>>;
export type DrizzleTransaction = Parameters<
  DrizzleDatabase['transaction']
>[0] extends (transaction: infer TTransaction) => Promise<unknown>
  ? TTransaction
  : never;
type TransactionConfig = Parameters<DrizzleDatabase['transaction']>[1];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Database access for repositories. Every unit of work runs in a transaction that
 * first sets the request context with `set_config(name, value, true)`: the
 * settings are local to the transaction, so nothing leaks to the next request
 * that reuses the pooled connection. Without context, RLS denies tenant rows.
 */
@Injectable()
export class DatabaseService {
  constructor(
    @Inject(getDrizzleToken())
    private readonly database: DrizzleDatabase,
  ) {}

  get $client(): Pool {
    return this.database.$client;
  }

  /** Runs `work` for a business user (optionally scoped to a business/branch). */
  withTenant<T>(
    context: { userId: string; businessId?: string; branchId?: string },
    work: (transaction: DrizzleTransaction) => Promise<T>,
  ): Promise<T> {
    return this.transactionWithSession(context, work);
  }

  /** Runs `work` for a Fortis platform user. */
  withPlatform<T>(
    context: { platformUserId: string },
    work: (transaction: DrizzleTransaction) => Promise<T>,
  ): Promise<T> {
    return this.transactionWithSession(context, work);
  }

  /** Runs `work` with exactly the ids in `session` as request context. */
  transactionWithSession<T>(
    session: RequestSession,
    callback: (transaction: DrizzleTransaction) => Promise<T>,
    config?: TransactionConfig,
  ): Promise<T> {
    const userId = contextId(session.userId, 'userId');
    const businessId = contextId(session.businessId, 'businessId');
    const branchId = contextId(session.branchId, 'branchId');
    const platformUserId = contextId(session.platformUserId, 'platformUserId');

    return this.database.transaction(async (transaction) => {
      await transaction.execute(sql`
        SELECT
          set_config('app.user_id', ${userId}, true),
          set_config('app.business_id', ${businessId}, true),
          set_config('app.branch_id', ${branchId}, true),
          set_config('app.platform_user_id', ${platformUserId}, true)
      `);
      return callback(transaction);
    }, config);
  }
}

/** '' for "not set"; throws for anything that is not a UUID. */
function contextId(value: string | undefined, name: string): string {
  if (value === undefined || value === '') return '';
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`Invalid ${name} for the database request context`);
  }
  return value;
}
