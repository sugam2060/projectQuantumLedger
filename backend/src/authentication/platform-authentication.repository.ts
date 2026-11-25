import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { platformUsers } from '../database/schemas';
import type { PlatformAccount, PlatformCredential } from './types';

type PlatformRow = {
  id: string;
  email: string;
  name: string;
  status: string;
  is_bootstrap: boolean;
};

/** SQL for platform-user (Fortis staff) sign-in. */
@Injectable()
export class PlatformAuthenticationRepository {
  constructor(private readonly database: DatabaseService) {}

  /** Pre-auth: the staff account for an email, with its password hash. */
  async findCredentialByEmail(
    email: string,
  ): Promise<PlatformCredential | null> {
    return this.database.transactionWithSession({}, async (tx) => {
      const result = await tx.execute<PlatformRow & { password_hash: string }>(
        sql`SELECT * FROM app.auth_find_platform_user_by_email(${email})`,
      );
      const row = result.rows[0];
      return row
        ? {
            id: row.id,
            email: row.email,
            name: row.name,
            passwordHash: row.password_hash,
            status: row.status,
            isBootstrap: row.is_bootstrap,
          }
        : null;
    });
  }

  /** The staff member's own account (no hash). */
  async findAccount(platformUserId: string): Promise<PlatformAccount | null> {
    return this.database.transactionWithSession(
      { platformUserId },
      async (tx) => {
        const result = await tx.execute<PlatformRow>(
          sql`SELECT * FROM app.auth_find_platform_user_by_id(${platformUserId}::uuid)`,
        );
        const row = result.rows[0];
        return row
          ? {
              id: row.id,
              email: row.email,
              name: row.name,
              status: row.status,
              isBootstrap: row.is_bootstrap,
            }
          : null;
      },
    );
  }

  /** Replaces the staff member's own password hash. */
  async updatePasswordHash(
    platformUserId: string,
    passwordHash: string,
  ): Promise<void> {
    await this.database.transactionWithSession(
      { platformUserId },
      async (tx) => {
        await tx
          .update(platformUsers)
          .set({ passwordHash, updatedAt: new Date() })
          .where(eq(platformUsers.id, platformUserId));
      },
    );
  }
}
