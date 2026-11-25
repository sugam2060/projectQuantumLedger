import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import type { RequestSession } from '../database/request_context.service';
import { terminals } from '../database/schemas';
import type { BusinessTransaction } from './types';

const TERMINAL_SUMMARY = {
  id: terminals.id,
  name: terminals.name,
  terminalCode: terminals.terminalCode,
  status: terminals.status,
};

/** SQL for terminal registration state inside a business. */
@Injectable()
export class TerminalsRepository {
  constructor(private readonly database: DatabaseService) {}

  inSession<T>(
    session: RequestSession,
    work: (tx: BusinessTransaction) => Promise<T>,
  ): Promise<T> {
    return this.database.transactionWithSession(session, work);
  }

  /**
   * Exposes the activation target to the terminals RLS update policy for this
   * transaction only (`set_config(..., true)`).
   */
  async setActivationContext(
    tx: BusinessTransaction,
    input: { businessId: string; branchId: string; terminalCode: string },
  ): Promise<void> {
    await tx.execute(sql`
          SELECT
            set_config('app.terminal_activation_business_id', ${input.businessId}, true),
            set_config('app.terminal_activation_branch_id', ${input.branchId}, true),
            set_config('app.terminal_activation_code', ${input.terminalCode}, true)
        `);
  }

  async findByCode(
    tx: BusinessTransaction,
    input: { businessId: string; branchId: string; terminalCode: string },
  ) {
    const [row] = await tx
      .select(TERMINAL_SUMMARY)
      .from(terminals)
      .where(
        and(
          eq(terminals.businessId, input.businessId),
          eq(terminals.branchId, input.branchId),
          eq(terminals.terminalCode, input.terminalCode),
        ),
      )
      .limit(1);
    return row;
  }

  /** Moves an inactive terminal to active; returns undefined if it was not inactive. */
  async activate(tx: BusinessTransaction, terminalId: string) {
    const [row] = await tx
      .update(terminals)
      .set({ status: 'active', updatedAt: new Date() })
      .where(
        and(eq(terminals.id, terminalId), eq(terminals.status, 'inactive')),
      )
      .returning(TERMINAL_SUMMARY);
    return row;
  }
}
