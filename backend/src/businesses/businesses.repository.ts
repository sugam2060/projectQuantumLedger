import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import type { RequestSession } from '../database/database.types';
import { business, businessMemberships } from '../database/schemas';
import type { BusinessTransaction } from './types';

type BusinessPatch = Partial<typeof business.$inferInsert>;

/** SQL for the business profile. */
@Injectable()
export class BusinessesRepository {
  constructor(private readonly database: DatabaseService) {}

  inSession<T>(
    session: RequestSession,
    work: (tx: BusinessTransaction) => Promise<T>,
  ): Promise<T> {
    return this.database.transactionWithSession(session, work);
  }

  async findProfile(tx: BusinessTransaction, businessId: string) {
    const [row] = await tx
      .select({
        id: business.id,
        legalName: business.legalName,
        displayName: business.displayName,
        address: business.address,
        addressDetails: business.addressDetails,
        primaryContactNumber: business.primaryContactNumber,
        primaryContactEmail: business.primaryContactEmail,
        isActive: business.isActive,
        createdAt: business.createdAt,
        updatedAt: business.updatedAt,
      })
      .from(business)
      .where(eq(business.id, businessId))
      .limit(1);
    return row;
  }

  async findActiveOwnerMembershipId(
    tx: BusinessTransaction,
    businessId: string,
    userId: string,
  ) {
    const [row] = await tx
      .select({ id: businessMemberships.id })
      .from(businessMemberships)
      .where(
        and(
          eq(businessMemberships.businessId, businessId),
          eq(businessMemberships.userId, userId),
          eq(businessMemberships.isOwner, true),
          eq(businessMemberships.isActive, true),
        ),
      )
      .limit(1);
    return row;
  }

  /** Reads the business row with `FOR UPDATE` so concurrent edits serialise. */
  async lockBusiness(tx: BusinessTransaction, businessId: string) {
    const [row] = await tx
      .select()
      .from(business)
      .where(eq(business.id, businessId))
      .limit(1)
      .for('update');
    return row;
  }

  async updateBusiness(
    tx: BusinessTransaction,
    businessId: string,
    patch: BusinessPatch,
  ) {
    const [row] = await tx
      .update(business)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(business.id, businessId))
      .returning({ updatedAt: business.updatedAt });
    return row;
  }
}
