import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

export interface EffectivePermissionsSnapshot {
  permissions: string[];
  roleVersion: number | null;
}

const CACHE_TTL_SECONDS = 5 * 60;

@Injectable()
export class EffectivePermissionsCacheService {
  constructor(private readonly redis: RedisService) {}

  async get(
    businessId: string,
    roleId: string,
  ): Promise<EffectivePermissionsSnapshot | null> {
    const serialized = await this.redis.get(this.key(businessId, roleId));
    if (!serialized) return null;

    try {
      const value: unknown = JSON.parse(serialized);
      if (
        typeof value !== 'object' ||
        value === null ||
        !('permissions' in value) ||
        !Array.isArray(value.permissions) ||
        !value.permissions.every(
          (permission: unknown) => typeof permission === 'string',
        ) ||
        !('roleVersion' in value) ||
        (value.roleVersion !== null &&
          (typeof value.roleVersion !== 'number' ||
            !Number.isInteger(value.roleVersion)))
      ) {
        await this.invalidate(businessId, [roleId]);
        return null;
      }

      return {
        permissions: value.permissions,
        roleVersion: value.roleVersion,
      };
    } catch {
      await this.invalidate(businessId, [roleId]);
      return null;
    }
  }

  set(
    businessId: string,
    roleId: string,
    snapshot: EffectivePermissionsSnapshot,
  ): Promise<void> {
    return this.redis.set(
      this.key(businessId, roleId),
      JSON.stringify(snapshot),
      CACHE_TTL_SECONDS,
    );
  }

  async invalidate(businessId: string, roleIds: string[]): Promise<void> {
    if (roleIds.length === 0) return;
    await Promise.all(
      [...new Set(roleIds)].map((roleId) =>
        this.redis.delete(this.key(businessId, roleId)),
      ),
    );
  }

  private key(businessId: string, roleId: string): string {
    return `effective_permissions:${businessId}:${roleId}`;
  }
}
