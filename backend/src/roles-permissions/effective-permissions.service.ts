import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { endpointRoleAccess, roles } from '../database/schemas';
import {
  EffectivePermissionsCacheService,
  type EffectivePermissionsSnapshot,
} from './effective-permissions-cache.service';
import { EndpointAccessCatalogService } from './endpoint-access-catalog.service';

/**
 * Effective permissions of a role in a business, as returned to clients on login,
 * refresh and /me so they can build navigation. Combines the role's own codes
 * with the business's endpoint-access configuration; cached in Redis per role.
 *
 * Interim: the authorization refactor replaces this with app.effective_permissions.
 */
@Injectable()
export class EffectivePermissionsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly cache: EffectivePermissionsCacheService,
    private readonly catalog: EndpointAccessCatalogService,
  ) {}

  /**
   * Snapshot for `roleId` in `businessId`, read as `userId` (RLS applies).
   * Returns null when the role does not exist.
   */
  async resolve(input: {
    userId: string;
    businessId: string;
    roleId: string;
  }): Promise<EffectivePermissionsSnapshot | null> {
    const cached = await this.cache.get(input.businessId, input.roleId);
    if (cached) return cached;

    const snapshot = await this.database.transactionWithSession(
      { userId: input.userId, businessId: input.businessId },
      async (tx) => {
        const [role] = await tx
          .select({ permissions: roles.permissions, version: roles.version })
          .from(roles)
          .where(eq(roles.id, input.roleId))
          .limit(1);
        if (!role) return null;

        const configurations = await tx
          .select({
            endpointKey: endpointRoleAccess.endpointKey,
            roleId: endpointRoleAccess.roleId,
          })
          .from(endpointRoleAccess)
          .where(eq(endpointRoleAccess.businessId, input.businessId));

        return {
          permissions: this.combine(
            input.roleId,
            readPermissions(role.permissions),
            configurations,
          ),
          roleVersion: role.version,
        };
      },
    );
    if (snapshot) {
      await this.cache.set(input.businessId, input.roleId, snapshot);
    }
    return snapshot;
  }

  private combine(
    roleId: string,
    rolePermissions: string[],
    configurations: Array<{ endpointKey: string; roleId: string }>,
  ): string[] {
    const configuredRolesByEndpoint = new Map<string, Set<string>>();
    for (const configuration of configurations) {
      const roleIds =
        configuredRolesByEndpoint.get(configuration.endpointKey) ??
        new Set<string>();
      roleIds.add(configuration.roleId);
      configuredRolesByEndpoint.set(configuration.endpointKey, roleIds);
    }

    const effective = new Set<string>();
    const catalog = this.catalog.list();
    const catalogKeys = new Set(catalog.map((entry) => entry.endpointKey));
    for (const permission of rolePermissions) {
      const allowed = configuredRolesByEndpoint.get(permission);
      if (!catalogKeys.has(permission) || !allowed || allowed.has(roleId)) {
        effective.add(permission);
      }
    }
    for (const endpoint of catalog) {
      const allowed = configuredRolesByEndpoint.get(endpoint.endpointKey);
      if (!allowed || allowed.has(roleId)) effective.add(endpoint.endpointKey);
    }
    return [...effective].sort();
  }
}

function readPermissions(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (permission): permission is string => typeof permission === 'string',
      )
    : [];
}
