import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import type { PermissionKey } from './permission.constant';

/** SQL for permission checks. The decision itself is app.has_permission. */
@Injectable()
export class AuthorizationRepository {
  constructor(private readonly database: DatabaseService) {}

  /** True only when the user holds every permission (in the branch, if given). */
  async hasAll(
    userId: string,
    businessId: string,
    branchId: string | undefined,
    permissions: readonly PermissionKey[],
  ): Promise<boolean> {
    return this.database.withTenant({ userId, businessId }, async (tx) => {
      const result = await tx.execute<{ allowed: boolean | null }>(
        sql`SELECT app.has_all_permissions(
              ${businessId}::uuid,
              ${branchId ?? null}::uuid,
              ARRAY[${sql.join(
                permissions.map((key) => sql`${key}`),
                sql`, `,
              )}]::text[]
            ) AS allowed`,
      );
      return result.rows[0]?.allowed === true;
    });
  }

  /** Every permission the user holds in the business (in the branch, if given). */
  async effective(
    userId: string,
    businessId: string,
    branchId: string | undefined,
  ): Promise<string[]> {
    return this.database.withTenant({ userId, businessId }, async (tx) => {
      const result = await tx.execute<{ key: string }>(
        sql`SELECT k AS key FROM app.effective_permissions(
              ${businessId}::uuid,
              ${branchId ?? null}::uuid
            ) AS k`,
      );
      return result.rows.map((row) => row.key);
    });
  }
}
