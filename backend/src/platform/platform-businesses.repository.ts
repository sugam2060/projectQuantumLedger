import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, isNull, or } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import {
  branches,
  business,
  businessMemberships,
  businessProvisioningRequests,
  ownerRedemptions,
  roles,
  terminals,
  users,
} from '../database/schemas';
import type { PlatformTransaction } from './types';

type NewBusiness = typeof business.$inferInsert;
type NewBranch = typeof branches.$inferInsert;
type NewTerminal = typeof terminals.$inferInsert;
type NewOwnerRedemption = typeof ownerRedemptions.$inferInsert;

/** All SQL used by platform staff to read and provision businesses. */
@Injectable()
export class PlatformBusinessesRepository {
  constructor(private readonly database: DatabaseService) {}

  /** Runs `work` in one transaction under a platform RLS session. */
  inPlatformTransaction<T>(
    platformUserId: string,
    work: (tx: PlatformTransaction) => Promise<T>,
  ): Promise<T> {
    return this.database.transactionWithSession(
      { isPlatform: true, platformUserId },
      work,
    );
  }

  async findBusiness(tx: PlatformTransaction, businessId: string) {
    const [row] = await tx
      .select()
      .from(business)
      .where(eq(business.id, businessId))
      .limit(1);
    return row;
  }

  async findBusinessSummary(tx: PlatformTransaction, businessId: string) {
    const [row] = await tx
      .select({ id: business.id, displayName: business.displayName })
      .from(business)
      .where(eq(business.id, businessId))
      .limit(1);
    return row;
  }

  async findBusinessIdByPan(tx: PlatformTransaction, pan: string) {
    const [row] = await tx
      .select({ id: business.id })
      .from(business)
      .where(eq(business.pan, pan))
      .limit(1);
    return row;
  }

  listBranches(tx: PlatformTransaction, businessId: string) {
    return tx
      .select()
      .from(branches)
      .where(eq(branches.businessId, businessId));
  }

  listMemberships(tx: PlatformTransaction, businessId: string) {
    return tx
      .select({
        id: businessMemberships.id,
        isOwner: businessMemberships.isOwner,
        isActive: businessMemberships.isActive,
        branchId: businessMemberships.branchId,
        roleId: businessMemberships.roleId,
        createdAt: businessMemberships.createdAt,
        updatedAt: businessMemberships.updatedAt,
        user: {
          id: users.id,
          email: users.emailNormalized,
          name: users.name,
          status: users.status,
        },
        role: {
          id: roles.id,
          name: roles.name,
          description: roles.description,
          isSystem: roles.isSystem,
        },
        branch: {
          id: branches.id,
          name: branches.name,
          code: branches.code,
          isActive: branches.isActive,
        },
      })
      .from(businessMemberships)
      .leftJoin(users, eq(businessMemberships.userId, users.id))
      .leftJoin(roles, eq(businessMemberships.roleId, roles.id))
      .leftJoin(branches, eq(businessMemberships.branchId, branches.id))
      .where(eq(businessMemberships.businessId, businessId));
  }

  async findBranch(
    tx: PlatformTransaction,
    businessId: string,
    branchId: string,
  ) {
    const [row] = await tx
      .select()
      .from(branches)
      .where(
        and(eq(branches.id, branchId), eq(branches.businessId, businessId)),
      )
      .limit(1);
    return row;
  }

  listBranchTerminals(
    tx: PlatformTransaction,
    businessId: string,
    branchId: string,
  ) {
    return tx
      .select()
      .from(terminals)
      .where(
        and(
          eq(terminals.businessId, businessId),
          eq(terminals.branchId, branchId),
        ),
      );
  }

  /** Active members who work at the branch, including business-wide members. */
  listActiveBranchEmployees(
    tx: PlatformTransaction,
    businessId: string,
    branchId: string,
  ) {
    return tx
      .select({
        membershipId: businessMemberships.id,
        isOwner: businessMemberships.isOwner,
        branchId: businessMemberships.branchId,
        createdAt: businessMemberships.createdAt,
        user: {
          id: users.id,
          email: users.emailNormalized,
          name: users.name,
          status: users.status,
        },
        role: {
          id: roles.id,
          name: roles.name,
          description: roles.description,
          isSystem: roles.isSystem,
        },
      })
      .from(businessMemberships)
      .leftJoin(users, eq(businessMemberships.userId, users.id))
      .leftJoin(roles, eq(businessMemberships.roleId, roles.id))
      .where(
        and(
          eq(businessMemberships.businessId, businessId),
          eq(businessMemberships.isActive, true),
          or(
            eq(businessMemberships.branchId, branchId),
            isNull(businessMemberships.branchId),
          ),
        ),
      );
  }

  async countBusinesses(tx: PlatformTransaction): Promise<number> {
    const [row] = await tx.select({ total: count() }).from(business);
    return row?.total ?? 0;
  }

  listBusinessesPage(
    tx: PlatformTransaction,
    page: { limit: number; offset: number },
  ) {
    return tx
      .select({
        id: business.id,
        legalName: business.legalName,
        displayName: business.displayName,
        isActive: business.isActive,
        primaryContactNumber: business.primaryContactNumber,
        primaryContactEmail: business.primaryContactEmail,
        createdAt: business.createdAt,
        updatedAt: business.updatedAt,
      })
      .from(business)
      .orderBy(desc(business.createdAt), desc(business.id))
      .limit(page.limit)
      .offset(page.offset);
  }

  async insertBranch(tx: PlatformTransaction, values: NewBranch) {
    const [row] = await tx
      .insert(branches)
      .values(values)
      .returning({ id: branches.id, name: branches.name });
    return row;
  }

  async insertMainBranch(tx: PlatformTransaction, values: NewBranch) {
    const [row] = await tx
      .insert(branches)
      .values(values)
      .returning({ id: branches.id });
    return row;
  }

  insertTerminals(tx: PlatformTransaction, values: NewTerminal[]) {
    return tx.insert(terminals).values(values).returning({
      id: terminals.id,
      name: terminals.name,
      terminalCode: terminals.terminalCode,
    });
  }

  async insertInitialTerminal(tx: PlatformTransaction, values: NewTerminal) {
    const [row] = await tx.insert(terminals).values(values).returning({
      id: terminals.id,
      terminalCode: terminals.terminalCode,
    });
    return row;
  }

  /** Emails of active owners of an active account, used for notifications. */
  listActiveOwnerEmails(tx: PlatformTransaction, businessId: string) {
    return tx
      .select({ email: users.emailNormalized })
      .from(businessMemberships)
      .innerJoin(users, eq(users.id, businessMemberships.userId))
      .where(
        and(
          eq(businessMemberships.businessId, businessId),
          eq(businessMemberships.isOwner, true),
          eq(businessMemberships.isActive, true),
          eq(users.status, 'active'),
        ),
      );
  }

  /** Locks the provisioning request row for the rest of the transaction. */
  async lockProvisioningRequest(tx: PlatformTransaction, requestId: string) {
    const [row] = await tx
      .select()
      .from(businessProvisioningRequests)
      .where(eq(businessProvisioningRequests.id, requestId))
      .limit(1)
      .for('update');
    return row;
  }

  async insertBusiness(tx: PlatformTransaction, values: NewBusiness) {
    const [row] = await tx
      .insert(business)
      .values(values)
      .returning({ id: business.id, displayName: business.displayName });
    return row;
  }

  async markRequestApproved(
    tx: PlatformTransaction,
    input: {
      requestId: string;
      platformUserId: string;
      businessId: string;
      at: Date;
    },
  ): Promise<void> {
    await tx
      .update(businessProvisioningRequests)
      .set({
        status: 'approved',
        reviewedBy: input.platformUserId,
        reviewedAt: input.at,
        provisionedBusinessId: input.businessId,
        updatedAt: input.at,
      })
      .where(eq(businessProvisioningRequests.id, input.requestId));
  }

  async insertOwnerRedemption(
    tx: PlatformTransaction,
    values: NewOwnerRedemption,
  ): Promise<void> {
    await tx.insert(ownerRedemptions).values(values);
  }
}
