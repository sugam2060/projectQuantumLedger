import type { DatabaseService } from '../../database/database.service';

/** Drizzle transaction handle used inside the businesses repositories. */
export type BusinessTransaction = Parameters<
  Parameters<DatabaseService['transactionWithSession']>[1]
>[0];
