import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import type { MemberView } from './types';

type MemberRow = {
  user_id: string;
  name: string;
  email: string;
  is_owner: boolean;
  branch_id: string | null;
  role_id: string | null;
  role_key: string | null;
  role_name: string | null;
  joined_at: Date;
};

const toView = (row: MemberRow): MemberView => ({
  userId: row.user_id,
  name: row.name,
  email: row.email,
  isOwner: row.is_owner,
  branchId: row.branch_id,
  role:
    row.role_id && row.role_key && row.role_name
      ? { id: row.role_id, key: row.role_key, name: row.role_name }
      : null,
  joinedAt: row.joined_at,
});

export type MemberChange = {
  changeRole: boolean;
  roleId: string | null;
  changeBranch: boolean;
  branchId: string | null;
};

/**
 * SQL for members. Reads go through RLS (member:read at the member's branch);
 * changes go through app.update_member / app.end_membership / overrides
 * functions, which enforce the anti-escalation rules.
 */
@Injectable()
export class MembersRepository {
  constructor(private readonly database: DatabaseService) {}

  /** Active members (of `scopeBranchId` only, on branch routes). */
  list(
    userId: string,
    businessId: string,
    scopeBranchId: string | undefined,
    targetUserId?: string,
  ): Promise<MemberView[]> {
    return this.database.withTenant({ userId, businessId }, async (tx) => {
      const result = await tx.execute<MemberRow>(sql`
        SELECT m.user_id, u.name, u.email_normalized AS email, m.is_owner,
               m.branch_id, r.id AS role_id, r.key AS role_key, r.name AS role_name,
               m.created_at AS joined_at
          FROM business_memberships m
          JOIN users u ON u.id = m.user_id
          LEFT JOIN roles r ON r.id = m.role_id
         WHERE m.business_id = ${businessId}::uuid
           AND m.is_active
           AND (${scopeBranchId ?? null}::uuid IS NULL
                OR COALESCE(m.branch_id, r.branch_id) = ${scopeBranchId ?? null}::uuid)
           AND (${targetUserId ?? null}::uuid IS NULL
                OR m.user_id = ${targetUserId ?? null}::uuid)
         ORDER BY m.is_owner DESC, u.name, m.user_id
         LIMIT 500`);
      return result.rows.map(toView);
    });
  }

  overridesAndPermissions(
    userId: string,
    businessId: string,
    targetUserId: string,
  ): Promise<{
    overrides: { permissionKey: string; effect: string }[];
    effectivePermissions: string[];
  }> {
    return this.database.withTenant({ userId, businessId }, async (tx) => {
      const overrides = await tx.execute<{
        permission_key: string;
        effect: string;
      }>(sql`
        SELECT permission_key, effect FROM member_permission_overrides
         WHERE business_id = ${businessId}::uuid AND user_id = ${targetUserId}::uuid
         ORDER BY permission_key`);
      const effective = await tx.execute<{ key: string }>(sql`
        SELECT k AS key FROM app.member_effective_permissions(
          ${businessId}::uuid, ${targetUserId}::uuid) AS k`);
      return {
        overrides: overrides.rows.map((row) => ({
          permissionKey: row.permission_key,
          effect: row.effect,
        })),
        effectivePermissions: effective.rows.map((row) => row.key),
      };
    });
  }

  update(
    userId: string,
    businessId: string,
    scopeBranchId: string | undefined,
    targetUserId: string,
    change: MemberChange,
  ): Promise<string> {
    return this.outcome(
      userId,
      businessId,
      sql`SELECT app.update_member(
            ${businessId}::uuid, ${scopeBranchId ?? null}::uuid, ${targetUserId}::uuid,
            ${change.changeRole}, ${change.roleId}::uuid,
            ${change.changeBranch}, ${change.branchId}::uuid) AS outcome`,
    );
  }

  end(
    userId: string,
    businessId: string,
    scopeBranchId: string | undefined,
    targetUserId: string,
  ): Promise<string> {
    return this.outcome(
      userId,
      businessId,
      sql`SELECT app.end_membership(
            ${businessId}::uuid, ${scopeBranchId ?? null}::uuid,
            ${targetUserId}::uuid) AS outcome`,
    );
  }

  setOverride(
    userId: string,
    businessId: string,
    targetUserId: string,
    permissionKey: string,
    effect: 'allow' | 'deny',
  ): Promise<string> {
    return this.outcome(
      userId,
      businessId,
      sql`SELECT app.set_member_override(
            ${businessId}::uuid, ${targetUserId}::uuid,
            ${permissionKey}, ${effect}) AS outcome`,
    );
  }

  clearOverride(
    userId: string,
    businessId: string,
    targetUserId: string,
    permissionKey: string,
  ): Promise<string> {
    return this.outcome(
      userId,
      businessId,
      sql`SELECT app.clear_member_override(
            ${businessId}::uuid, ${targetUserId}::uuid,
            ${permissionKey}) AS outcome`,
    );
  }

  private outcome(
    userId: string,
    businessId: string,
    query: ReturnType<typeof sql>,
  ): Promise<string> {
    return this.database.withTenant({ userId, businessId }, async (tx) => {
      const result = await tx.execute<{ outcome: string }>(query);
      return result.rows[0]?.outcome ?? 'forbidden';
    });
  }
}
