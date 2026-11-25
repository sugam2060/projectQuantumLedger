import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { businessProvisioningRequests } from '../database/schemas';

type NewBusinessRequest = typeof businessProvisioningRequests.$inferInsert;

/** SQL for public business enquiries awaiting platform review. */
@Injectable()
export class BusinessRequestsRepository {
  constructor(private readonly database: DatabaseService) {}

  /** Inserts a request with no tenant context (the caller is anonymous). */
  async insert(values: NewBusinessRequest): Promise<void> {
    await this.database.transactionWithSession({}, async (tx) => {
      await tx.insert(businessProvisioningRequests).values(values);
    });
  }
}
