import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, lt, lte, or } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import type { RequestSession } from '../database/request_context.service';
import { branches, businessMemberships, terminals } from '../database/schemas';
import type { BranchCursor, BusinessTransaction } from './types';

/** SQL for branches and the caller's membership scope. */
@Injectable()
export class BranchesRepository {
  constructor(private readonly database: DatabaseService) {}

  inSession<T>(
    session: RequestSession,
    work: (tx: BusinessTransaction) => Promise<T>,
  ): Promise<T> {
    return this.database.transactionWithSession(session, work);
  }

  /** The caller's active membership in the business (branch scope + owner flag). */
  async findActiveMembership(
    tx: BusinessTransaction,
    businessId: string,
    userId: string,
  ) {
    const [row] = await tx
      .select({
        branchId: businessMemberships.branchId,
        isOwner: businessMemberships.isOwner,
      })
      .from(businessMemberships)
      .where(
        and(
          eq(businessMemberships.businessId, businessId),
          eq(businessMemberships.userId, userId),
          eq(businessMemberships.isActive, true),
        ),
      )
      .limit(1);
    return row;
  }

  /**
   * One keyset page, newest first. Fetches `limit + 1` rows so the caller can tell
   * whether another page exists.
   */
  listPage(
    tx: BusinessTransaction,
    input: {
      businessId: string;
      scopeBranchId: string | null;
      from: Date | null;
      to: Date | null;
      cursor: BranchCursor | null;
      limit: number;
    },
  ) {
    const conditions = [eq(branches.businessId, input.businessId)];
    if (input.scopeBranchId) {
      conditions.push(eq(branches.id, input.scopeBranchId));
    }
    if (input.from) conditions.push(gte(branches.createdAt, input.from));
    if (input.to) conditions.push(lte(branches.createdAt, input.to));
    if (input.cursor) {
      conditions.push(
        or(
          lt(branches.createdAt, input.cursor.createdAt),
          and(
            eq(branches.createdAt, input.cursor.createdAt),
            lt(branches.id, input.cursor.id),
          ),
        )!,
      );
    }

    return tx
      .select({
        id: branches.id,
        name: branches.name,
        code: branches.code,
        address: branches.address,
        contactNumber: branches.contactNumber,
        isActive: branches.isActive,
        createdAt: branches.createdAt,
        updatedAt: branches.updatedAt,
      })
      .from(branches)
      .where(and(...conditions))
      .orderBy(desc(branches.createdAt), desc(branches.id))
      .limit(input.limit + 1);
  }

  async findBranch(
    tx: BusinessTransaction,
    businessId: string,
    branchId: string,
  ) {
    const [row] = await tx
      .select({
        id: branches.id,
        businessId: branches.businessId,
        name: branches.name,
        code: branches.code,
        address: branches.address,
        contactNumber: branches.contactNumber,
        isActive: branches.isActive,
        createdAt: branches.createdAt,
        updatedAt: branches.updatedAt,
      })
      .from(branches)
      .where(
        and(eq(branches.businessId, businessId), eq(branches.id, branchId)),
      )
      .limit(1);
    return row;
  }

  countTerminalsByStatus(
    tx: BusinessTransaction,
    businessId: string,
    branchId: string,
  ) {
    return tx
      .select({ status: terminals.status, total: count().mapWith(Number) })
      .from(terminals)
      .where(
        and(
          eq(terminals.businessId, businessId),
          eq(terminals.branchId, branchId),
        ),
      )
      .groupBy(terminals.status);
  }

  countMembersByActive(
    tx: BusinessTransaction,
    businessId: string,
    branchId: string,
  ) {
    return tx
      .select({
        isActive: businessMemberships.isActive,
        total: count().mapWith(Number),
      })
      .from(businessMemberships)
      .where(
        and(
          eq(businessMemberships.businessId, businessId),
          eq(businessMemberships.branchId, branchId),
        ),
      )
      .groupBy(businessMemberships.isActive);
  }
}
