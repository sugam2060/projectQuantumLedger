import type { DatabaseService } from '../../database/database.service';

/** The Drizzle transaction handle passed to `transactionWithSession` callbacks. */
export type AuditTransaction = Parameters<
  Parameters<DatabaseService['transactionWithSession']>[1]
>[0];
