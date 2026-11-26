import { Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import {
  business,
  businessMemberships,
  ownerRedemptions,
  terminals,
  users,
} from '../database/schemas';
import type {
  ActiveMembership,
  ActiveTerminal,
  UserAccount,
  UserCredential,
} from './types';

type AuthTransaction = Parameters<
  Parameters<DatabaseService['transactionWithSession']>[1]
>[0];

/**
 * SQL for business-user sign-in. Lookups that happen before a user context
 * exists go through app.auth_* SECURITY DEFINER functions; everything else runs
 * as the user (app.user_id set), so RLS applies.
 */
@Injectable()
export class AuthenticationRepository {
  constructor(private readonly database: DatabaseService) {}

  /** Pre-auth: the account for an email, with its password hash. */
  async findCredentialByEmail(email: string): Promise<UserCredential | null> {
    return this.database.transactionWithSession({}, async (tx) => {
      const result = await tx.execute<{
        id: string;
        email: string;
        name: string;
        password_hash: string;
        status: string;
      }>(sql`SELECT * FROM app.auth_find_user_by_email(${email})`);
      const row = result.rows[0];
      return row
        ? {
            id: row.id,
            email: row.email,
            name: row.name,
            passwordHash: row.password_hash,
            status: row.status,
          }
        : null;
    });
  }

  /** The user's own account (no hash); null when it no longer exists. */
  async findAccount(userId: string): Promise<UserAccount | null> {
    return this.database.transactionWithSession({ userId }, async (tx) => {
      const result = await tx.execute<UserAccount>(
        sql`SELECT * FROM app.auth_find_user_by_id(${userId}::uuid)`,
      );
      return result.rows[0] ?? null;
    });
  }

  /** The user's active memberships in active businesses. */
  async listActiveMemberships(userId: string): Promise<ActiveMembership[]> {
    return this.database.transactionWithSession({ userId }, async (tx) => {
      const result = await tx.execute<{
        membership_id: string;
        business_id: string;
        branch_id: string | null;
        is_owner: boolean;
        role_id: string | null;
        role_name: string | null;
        role_version: number | null;
      }>(sql`SELECT * FROM app.auth_list_active_memberships(${userId}::uuid)`);
      return result.rows.map((row) => ({
        membershipId: row.membership_id,
        businessId: row.business_id,
        branchId: row.branch_id,
        isOwner: row.is_owner,
        roleId: row.role_id,
        roleName: row.role_name,
        roleVersion: row.role_version,
      }));
    });
  }

  /** An active terminal of an active branch, or null. */
  async findActiveTerminal(terminalId: string): Promise<ActiveTerminal | null> {
    return this.database.transactionWithSession({}, async (tx) => {
      const result = await tx.execute<{
        id: string;
        business_id: string;
        branch_id: string;
      }>(sql`SELECT * FROM app.auth_find_active_terminal(${terminalId}::uuid)`);
      const row = result.rows[0];
      return row
        ? { id: row.id, businessId: row.business_id, branchId: row.branch_id }
        : null;
    });
  }

  /** Replaces the user's own password hash (legacy rehash, password change). */
  async updatePasswordHash(
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    await this.database.transactionWithSession({ userId }, async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, userId));
    });
  }

  // -------------------------------------------------------------------------
  // Owner registration (one transaction, driven by AuthenticationService).
  // The owner_redemptions / users / business_memberships policies admit these
  // statements only while the redemption hash and email are set for the
  // transaction (see setRedemptionContext).
  // -------------------------------------------------------------------------

  inRegistrationTransaction<T>(
    work: (tx: AuthTransaction) => Promise<T>,
  ): Promise<T> {
    return this.database.transactionWithSession({}, work);
  }

  async setRedemptionContext(
    tx: AuthTransaction,
    input: { tokenHash: string; email: string },
  ): Promise<void> {
    await tx.execute(sql`
      SELECT
        set_config('app.owner_redemption_hash', ${input.tokenHash}, true),
        set_config('app.registration_email', ${input.email}, true)
    `);
  }

  /** Locks an open, unexpired redemption by its hash. */
  async lockOpenRedemption(tx: AuthTransaction, tokenHash: string) {
    const [row] = await tx
      .select({
        id: ownerRedemptions.id,
        businessId: ownerRedemptions.businessId,
        email: ownerRedemptions.emailNormalized,
      })
      .from(ownerRedemptions)
      .where(
        and(
          eq(ownerRedemptions.tokenHash, tokenHash),
          isNull(ownerRedemptions.consumedAt),
          isNull(ownerRedemptions.revokedAt),
          gt(ownerRedemptions.expiresAt, new Date()),
        ),
      )
      .limit(1)
      .for('update');
    return row;
  }

  async setBusinessContext(
    tx: AuthTransaction,
    businessId: string,
  ): Promise<void> {
    await tx.execute(sql`
      SELECT
        set_config('app.business_id', ${businessId}, true),
        set_config('app.is_owner', 'true', true)
    `);
  }

  async findBusinessState(tx: AuthTransaction, businessId: string) {
    const [row] = await tx
      .select({ id: business.id, isActive: business.isActive })
      .from(business)
      .where(eq(business.id, businessId))
      .limit(1);
    return row;
  }

  /** Existing account for the email (with hash), via the pre-auth lookup. */
  async findUserByEmailForRegistration(tx: AuthTransaction, email: string) {
    const result = await tx.execute<{
      id: string;
      password_hash: string;
      status: string;
    }>(
      sql`SELECT id, password_hash, status FROM app.auth_find_user_by_email(${email})`,
    );
    const row = result.rows[0];
    return row
      ? { id: row.id, passwordHash: row.password_hash, status: row.status }
      : undefined;
  }

  async insertUser(
    tx: AuthTransaction,
    values: { email: string; passwordHash: string; name: string },
  ): Promise<string | undefined> {
    const [row] = await tx
      .insert(users)
      .values({
        emailNormalized: values.email,
        passwordHash: values.passwordHash,
        name: values.name,
        status: 'active',
      })
      .returning({ id: users.id });
    return row?.id;
  }

  async setUserContext(tx: AuthTransaction, userId: string): Promise<void> {
    await tx.execute(sql`
      SELECT
        set_config('app.user_id', ${userId}, true),
        set_config('app.branch_id', '', true)
    `);
  }

  async insertOwnerMembership(
    tx: AuthTransaction,
    input: { businessId: string; userId: string },
  ): Promise<void> {
    await tx.insert(businessMemberships).values({
      businessId: input.businessId,
      userId: input.userId,
      roleId: null,
      branchId: null,
      isOwner: true,
      isActive: true,
    });
  }

  async activateBusiness(tx: AuthTransaction, businessId: string) {
    await tx
      .update(business)
      .set({ isActive: true, updatedAt: new Date() })
      .where(eq(business.id, businessId));
  }

  async setTerminalActivationContext(
    tx: AuthTransaction,
    input: {
      businessId: string;
      branchId: string;
      terminalCode: string;
      tokenHash: string;
    },
  ): Promise<void> {
    await tx.execute(sql`
      SELECT
        set_config('app.terminal_activation_business_id', ${input.businessId}, true),
        set_config('app.terminal_activation_branch_id', ${input.branchId}, true),
        set_config('app.terminal_activation_code', ${input.terminalCode}, true),
        set_config('app.owner_redemption_hash', ${input.tokenHash}, true)
    `);
  }

  async findInactiveTerminal(
    tx: AuthTransaction,
    input: { businessId: string; branchId: string; terminalCode: string },
  ) {
    const [row] = await tx
      .select({ terminalId: terminals.id, branchId: terminals.branchId })
      .from(terminals)
      .where(
        and(
          eq(terminals.businessId, input.businessId),
          eq(terminals.branchId, input.branchId),
          eq(terminals.terminalCode, input.terminalCode),
          eq(terminals.status, 'inactive'),
        ),
      )
      .limit(1);
    return row;
  }

  async activateTerminal(tx: AuthTransaction, terminalId: string) {
    await tx
      .update(terminals)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(terminals.id, terminalId));
  }

  async consumeRedemption(
    tx: AuthTransaction,
    input: { redemptionId: string; userId: string },
  ) {
    await tx
      .update(ownerRedemptions)
      .set({ consumedAt: new Date(), consumedByUserId: input.userId })
      .where(eq(ownerRedemptions.id, input.redemptionId));
  }
}

export type { AuthTransaction };
