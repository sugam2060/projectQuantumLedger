import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { invitations, platformUsers } from '../database/schemas';
import type { PlatformTransaction } from './types';

type NewInvitation = typeof invitations.$inferInsert;

/** SQL for platform users and their invitations. */
@Injectable()
export class PlatformUsersRepository {
  constructor(private readonly database: DatabaseService) {}

  /** Runs `work` in one transaction as the inviting platform user. */
  inInvitationTransaction<T>(
    input: { platformUserId: string; inviteeEmail: string },
    work: (tx: PlatformTransaction) => Promise<T>,
  ): Promise<T> {
    return this.database.transactionWithSession(
      { platformUserId: input.platformUserId },
      work,
    );
  }

  async findPlatformUserIdByEmail(tx: PlatformTransaction, email: string) {
    const [row] = await tx
      .select({ id: platformUsers.id })
      .from(platformUsers)
      .where(eq(platformUsers.emailNormalized, email))
      .limit(1);
    return row;
  }

  async insertInvitation(
    tx: PlatformTransaction,
    values: NewInvitation,
  ): Promise<void> {
    await tx.insert(invitations).values(values);
  }
}
