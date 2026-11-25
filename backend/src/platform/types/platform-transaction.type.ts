import type { DatabaseService } from '../../database/database.service';

/** Drizzle transaction handle used inside platform repositories. */
export type PlatformTransaction = Parameters<
  Parameters<DatabaseService['transactionWithSession']>[1]
>[0];
