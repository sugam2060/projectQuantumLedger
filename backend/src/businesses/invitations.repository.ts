import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import type {
  AcceptOutcome,
  InvitationPreview,
  InvitationResultStatus,
  InvitationView,
} from './types';

type InvitationRow = {
  id: string;
  email: string;
  role_id: string | null;
  branch_id: string | null;
  status: InvitationView['status'];
  expires_at: Date;
  created_at: Date;
};

export type NewInvitation = { email: string; tokenHash: string };

/**
 * SQL for business invitations. Writes go through the app.*_business_invitation
 * functions; the public preview/accept run without a user context and are
 * decided entirely in SQL.
 */
@Injectable()
export class InvitationsRepository {
  constructor(private readonly database: DatabaseService) {}

  /** One outcome per address; all in one transaction. */
  create(
    userId: string,
    businessId: string,
    scopeBranchId: string | undefined,
    input: {
      invitations: NewInvitation[];
      roleId: string;
      branchId: string | null;
      expiresAt: Date;
    },
  ): Promise<InvitationResultStatus[]> {
    return this.database.withTenant({ userId, businessId }, async (tx) => {
      const outcomes: InvitationResultStatus[] = [];
      for (const invitation of input.invitations) {
        const result = await tx.execute<{ outcome: InvitationResultStatus }>(
          sql`SELECT app.create_business_invitation(
                ${businessId}::uuid, ${scopeBranchId ?? null}::uuid,
                ${invitation.email}, ${input.roleId}::uuid,
                ${input.branchId}::uuid, ${invitation.tokenHash},
                ${input.expiresAt.toISOString()}::timestamptz) AS outcome`,
        );
        outcomes.push(result.rows[0]?.outcome ?? 'forbidden');
      }
      return outcomes;
    });
  }

  /** Most recent invitations visible to the caller (RLS: member:read). */
  list(
    userId: string,
    businessId: string,
    scopeBranchId: string | undefined,
  ): Promise<InvitationView[]> {
    return this.database.withTenant({ userId, businessId }, async (tx) => {
      const result = await tx.execute<InvitationRow>(sql`
        SELECT i.id, i.email_normalized AS email, i.role_id, i.branch_id,
               CASE WHEN i.consumed_at IS NOT NULL THEN 'accepted'
                    WHEN i.revoked_at IS NOT NULL THEN 'revoked'
                    WHEN i.expires_at <= now() THEN 'expired'
                    ELSE 'open' END AS status,
               i.expires_at, i.created_at
          FROM invitations i
         WHERE i.business_id = ${businessId}::uuid
           AND i.invitation_type = 'business_user'
           AND (${scopeBranchId ?? null}::uuid IS NULL
                OR i.branch_id = ${scopeBranchId ?? null}::uuid)
         ORDER BY i.created_at DESC, i.id
         LIMIT 200`);
      return result.rows.map((row) => ({
        id: row.id,
        email: row.email,
        roleId: row.role_id,
        branchId: row.branch_id,
        status: row.status,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
      }));
    });
  }

  reissue(
    userId: string,
    businessId: string,
    scopeBranchId: string | undefined,
    invitationId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<{ outcome: string; email: string | null }> {
    return this.database.withTenant({ userId, businessId }, async (tx) => {
      const result = await tx.execute<{ outcome: string; email: string }>(
        sql`SELECT outcome, email FROM app.reissue_business_invitation(
              ${businessId}::uuid, ${scopeBranchId ?? null}::uuid,
              ${invitationId}::uuid, ${tokenHash},
              ${expiresAt.toISOString()}::timestamptz)`,
      );
      const row = result.rows[0];
      return { outcome: row?.outcome ?? 'forbidden', email: row?.email };
    });
  }

  revoke(
    userId: string,
    businessId: string,
    scopeBranchId: string | undefined,
    invitationId: string,
  ): Promise<string> {
    return this.database.withTenant({ userId, businessId }, async (tx) => {
      const result = await tx.execute<{ outcome: string }>(
        sql`SELECT app.revoke_business_invitation(
              ${businessId}::uuid, ${scopeBranchId ?? null}::uuid,
              ${invitationId}::uuid) AS outcome`,
      );
      return result.rows[0]?.outcome ?? 'forbidden';
    });
  }

  /** Public: the open invitation behind a token hash, if any. */
  preview(tokenHash: string): Promise<InvitationPreview | null> {
    return this.database.transactionWithSession({}, async (tx) => {
      const result = await tx.execute<{
        email: string;
        business_name: string;
        role_name: string;
        branch_name: string | null;
        expires_at: Date;
        account_exists: boolean;
      }>(sql`SELECT * FROM app.preview_business_invitation(${tokenHash})`);
      const row = result.rows[0];
      return row
        ? {
            email: row.email,
            businessName: row.business_name,
            roleName: row.role_name,
            branchName: row.branch_name,
            expiresAt: row.expires_at,
            accountExists: row.account_exists,
          }
        : null;
    });
  }

  /** Pre-auth: the account for an email with its hash (sign-in lookup). */
  findCredential(
    email: string,
  ): Promise<{ id: string; passwordHash: string; status: string } | null> {
    return this.database.transactionWithSession({}, async (tx) => {
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
        : null;
    });
  }

  accept(input: {
    tokenHash: string;
    userId: string | null;
    name: string | null;
    passwordHash: string | null;
    confirmResignation: boolean;
  }): Promise<{
    outcome: AcceptOutcome;
    userId: string | null;
    businessId: string | null;
  }> {
    return this.database.transactionWithSession({}, async (tx) => {
      const result = await tx.execute<{
        outcome: AcceptOutcome;
        user_id: string | null;
        business_id: string | null;
      }>(
        sql`SELECT outcome, user_id, business_id FROM app.accept_business_invitation(
              ${input.tokenHash}, ${input.userId}::uuid, ${input.name},
              ${input.passwordHash}, ${input.confirmResignation})`,
      );
      const row = result.rows[0];
      return {
        outcome: row?.outcome ?? 'invalid',
        userId: row?.user_id ?? null,
        businessId: row?.business_id ?? null,
      };
    });
  }
}
