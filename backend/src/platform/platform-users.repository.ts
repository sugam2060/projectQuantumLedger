import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { invitations } from '../database/schemas';
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

  /** True when a platform account already uses this email. */
  async isPlatformEmailInUse(
    tx: PlatformTransaction,
    email: string,
  ): Promise<boolean> {
    const result = await tx.execute<{ in_use: boolean }>(
      sql`SELECT app.platform_email_in_use(${email}) AS in_use`,
    );
    return result.rows[0]?.in_use === true;
  }

  /** Public: consumes a staff invitation and creates the account (in SQL). */
  acceptInvitation(
    tokenHash: string,
    passwordHash: string,
  ): Promise<{ outcome: string; platformUserId: string | null }> {
    return this.database.transactionWithSession({}, async (tx) => {
      const result = await tx.execute<{
        outcome: string;
        platform_user_id: string | null;
      }>(
        sql`SELECT outcome, platform_user_id
              FROM app.accept_platform_invitation(${tokenHash}, ${passwordHash})`,
      );
      const row = result.rows[0];
      return {
        outcome: row?.outcome ?? 'invalid',
        platformUserId: row?.platform_user_id ?? null,
      };
    });
  }

  async insertInvitation(
    tx: PlatformTransaction,
    values: NewInvitation,
  ): Promise<void> {
    await tx.insert(invitations).values(values);
  }
}
