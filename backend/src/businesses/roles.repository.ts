import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import type { RoleView } from './types';

type RoleRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  is_system: boolean;
  branch_id: string | null;
  version: number;
  permissions: string[];
};

export type SaveRoleInput = {
  roleId: string | null;
  key: string | null;
  name: string | null;
  description: string | null;
  branchId: string | null;
  permissions: string[] | null;
};

const toView = (row: RoleRow): RoleView => ({
  id: row.id,
  key: row.key,
  name: row.name,
  description: row.description,
  isSystem: row.is_system,
  branchId: row.branch_id,
  version: row.version,
  permissions: row.permissions,
});

/** SQL for roles. Reads go through RLS; writes through app.save_role / app.delete_role. */
@Injectable()
export class RolesRepository {
  constructor(private readonly database: DatabaseService) {}

  listPermissions(
    userId: string,
  ): Promise<{ key: string; description: string }[]> {
    return this.database.withTenant({ userId }, async (tx) => {
      const result = await tx.execute<{ key: string; description: string }>(
        sql`SELECT key, description FROM permissions ORDER BY key`,
      );
      return result.rows;
    });
  }

  /** System roles plus the business's roles (one role when `roleId` is given). */
  listRoles(
    userId: string,
    businessId: string,
    roleId?: string,
  ): Promise<RoleView[]> {
    return this.database.withTenant({ userId, businessId }, async (tx) => {
      const result = await tx.execute<RoleRow>(sql`
        SELECT r.id, r.key, r.name, r.description, r.is_system, r.branch_id, r.version,
               COALESCE(
                 array_agg(rp.permission_key ORDER BY rp.permission_key)
                   FILTER (WHERE rp.permission_key IS NOT NULL),
                 '{}'
               ) AS permissions
          FROM roles r
          LEFT JOIN role_permissions rp ON rp.role_id = r.id
         WHERE (r.business_id IS NULL OR r.business_id = ${businessId}::uuid)
           AND (${roleId ?? null}::uuid IS NULL OR r.id = ${roleId ?? null}::uuid)
         GROUP BY r.id
         ORDER BY r.is_system DESC, r.name`);
      return result.rows.map(toView);
    });
  }

  saveRole(
    userId: string,
    businessId: string,
    input: SaveRoleInput,
  ): Promise<{ outcome: string; roleId: string | null }> {
    return this.database.withTenant({ userId, businessId }, async (tx) => {
      const permissions =
        input.permissions === null
          ? sql`NULL::text[]`
          : sql`ARRAY[${sql.join(
              input.permissions.map((key) => sql`${key}`),
              sql`, `,
            )}]::text[]`;
      const result = await tx.execute<{ outcome: string; role_id: string }>(
        sql`SELECT outcome, role_id FROM app.save_role(
              ${businessId}::uuid,
              ${input.roleId}::uuid,
              ${input.key},
              ${input.name},
              ${input.description},
              ${input.branchId}::uuid,
              ${input.permissions !== null},
              ${input.permissions?.length === 0 ? sql`'{}'::text[]` : permissions}
            )`,
      );
      const row = result.rows[0];
      return { outcome: row?.outcome ?? 'forbidden', roleId: row?.role_id };
    });
  }

  deleteRole(
    userId: string,
    businessId: string,
    roleId: string,
  ): Promise<string> {
    return this.database.withTenant({ userId, businessId }, async (tx) => {
      const result = await tx.execute<{ outcome: string }>(
        sql`SELECT app.delete_role(${businessId}::uuid, ${roleId}::uuid) AS outcome`,
      );
      return result.rows[0]?.outcome ?? 'forbidden';
    });
  }
}
