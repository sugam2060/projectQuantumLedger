import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import type { SessionActor } from './types';

export type PasswordActorKind = 'user' | 'platform';

/** SQL for password changes and resets (app.auth_* SECURITY DEFINER functions). */
@Injectable()
export class PasswordsRepository {
  constructor(private readonly database: DatabaseService) {}

  /** The signed-in actor's current hash, or null if the account is not active. */
  async currentHash(actor: SessionActor): Promise<string | null> {
    return this.database.transactionWithSession(actor, async (tx) => {
      const result = await tx.execute<{ hash: string | null }>(
        sql`SELECT app.auth_current_password_hash() AS hash`,
      );
      return result.rows[0]?.hash ?? null;
    });
  }

  /**
   * Stores a reset token for the active account with this email. Returns the
   * account to email, or null (unknown or inactive) without revealing which.
   */
  async createResetToken(input: {
    actor: PasswordActorKind;
    email: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<{ id: string; email: string; name: string } | null> {
    return this.database.transactionWithSession({}, async (tx) => {
      const result = await tx.execute<{
        account_id: string;
        email: string;
        name: string;
      }>(sql`
        SELECT * FROM app.auth_create_reset_token(
          ${input.actor}, ${input.email}, ${input.tokenHash},
          ${input.expiresAt.toISOString()}::timestamptz
        )`);
      const row = result.rows[0];
      return row
        ? { id: row.account_id, email: row.email, name: row.name }
        : null;
    });
  }

  /**
   * Consumes a reset token, sets the new hash and revokes every session of the
   * account, atomically. Returns the account id, or null when the token is not
   * usable.
   */
  async consumeResetToken(input: {
    actor: PasswordActorKind;
    tokenHash: string;
    passwordHash: string;
  }): Promise<string | null> {
    return this.database.transactionWithSession({}, async (tx) => {
      const result = await tx.execute<{ account_id: string | null }>(sql`
        SELECT app.auth_consume_reset_token(
          ${input.actor}, ${input.tokenHash}, ${input.passwordHash}
        ) AS account_id`);
      return result.rows[0]?.account_id ?? null;
    });
  }
}
