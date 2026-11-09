import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { RequestSession } from '../database/request_context.service';
import { DatabaseService } from '../database/database.service';
import {
  businessMemberships,
  endpointRoleAccess,
  roles,
} from '../database/schema';

export interface EndpointRoleConfiguration {
  endpointKey: string;
  roleIds: string[];
}

const ENDPOINT_KEY_PATTERN = /^[a-z][a-z0-9_.:-]{1,119}$/;

@Injectable()
export class EndpointAccessService {
  constructor(private readonly database: DatabaseService) {}

  async listConfigurations(
    session: RequestSession,
  ): Promise<EndpointRoleConfiguration[]> {
    this.requireOwnerClaim(session);

    return this.database.transactionWithSession(session, async (tx) => {
      await this.assertActiveOwner(tx, session);
      const rows = await tx
        .select({
          endpointKey: endpointRoleAccess.endpointKey,
          roleId: endpointRoleAccess.roleId,
        })
        .from(endpointRoleAccess)
        .where(eq(endpointRoleAccess.businessId, session.businessId!));

      const grouped = new Map<string, string[]>();
      for (const row of rows) {
        const roleIds = grouped.get(row.endpointKey) ?? [];
        roleIds.push(row.roleId);
        grouped.set(row.endpointKey, roleIds);
      }

      return Array.from(grouped, ([endpointKey, roleIds]) => ({
        endpointKey,
        roleIds,
      }));
    });
  }

  async setRequiredRoles(
    session: RequestSession,
    endpointKey: string,
    roleIds: string[],
  ): Promise<EndpointRoleConfiguration> {
    this.requireOwnerClaim(session);
    this.validateEndpointKey(endpointKey);

    const uniqueRoleIds = [...new Set(roleIds)];
    if (uniqueRoleIds.length === 0) {
      throw new BadRequestException('At least one role is required');
    }
    if (uniqueRoleIds.length !== roleIds.length) {
      throw new BadRequestException('Role IDs must not contain duplicates');
    }

    return this.database.transactionWithSession(session, async (tx) => {
      await this.assertActiveOwner(tx, session);

      const businessRoles = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(
          and(
            inArray(roles.id, uniqueRoleIds),
            or(
              eq(roles.businessId, session.businessId!),
              isNull(roles.businessId),
            ),
          ),
        );
      if (businessRoles.length !== uniqueRoleIds.length) {
        throw new BadRequestException(
          'Every role must belong to the active business',
        );
      }

      await tx
        .delete(endpointRoleAccess)
        .where(
          and(
            eq(endpointRoleAccess.businessId, session.businessId!),
            eq(endpointRoleAccess.endpointKey, endpointKey),
          ),
        );

      await tx.insert(endpointRoleAccess).values(
        uniqueRoleIds.map((roleId) => ({
          businessId: session.businessId!,
          endpointKey,
          roleId,
        })),
      );

      return { endpointKey, roleIds: uniqueRoleIds };
    });
  }

  async clearRequiredRoles(
    session: RequestSession,
    endpointKey: string,
  ): Promise<void> {
    this.requireOwnerClaim(session);
    this.validateEndpointKey(endpointKey);

    await this.database.transactionWithSession(session, async (tx) => {
      await this.assertActiveOwner(tx, session);
      await tx
        .delete(endpointRoleAccess)
        .where(
          and(
            eq(endpointRoleAccess.businessId, session.businessId!),
            eq(endpointRoleAccess.endpointKey, endpointKey),
          ),
        );
    });
  }

  async hasAccess(
    session: RequestSession,
    endpointKey: string,
  ): Promise<boolean> {
    if (!session.businessId || !session.userId) return false;

    return this.database.transactionWithSession(session, async (tx) => {
      const configuredRoles = await tx
        .select({ roleId: endpointRoleAccess.roleId })
        .from(endpointRoleAccess)
        .where(
          and(
            eq(endpointRoleAccess.businessId, session.businessId!),
            eq(endpointRoleAccess.endpointKey, endpointKey),
          ),
        );

      // Unconfigured endpoints keep their existing access behavior.
      if (configuredRoles.length === 0) return true;

      const [membership] = await tx
        .select({ roleId: businessMemberships.roleId })
        .from(businessMemberships)
        .where(
          and(
            eq(businessMemberships.businessId, session.businessId!),
            eq(businessMemberships.userId, session.userId!),
            eq(businessMemberships.isActive, true),
          ),
        )
        .limit(1);

      return (
        membership !== undefined &&
        configuredRoles.some(
          (configuration) => configuration.roleId === membership.roleId,
        )
      );
    });
  }

  private requireOwnerClaim(session: RequestSession): void {
    if (!session.businessId || !session.userId || session.isOwner !== true) {
      throw new ForbiddenException(
        'Only the active business owner can manage access',
      );
    }
  }

  private async assertActiveOwner(
    tx: Parameters<Parameters<DatabaseService['transactionWithSession']>[1]>[0],
    session: RequestSession,
  ): Promise<void> {
    const [ownerMembership] = await tx
      .select({ id: businessMemberships.id })
      .from(businessMemberships)
      .where(
        and(
          eq(businessMemberships.businessId, session.businessId!),
          eq(businessMemberships.userId, session.userId!),
          eq(businessMemberships.isActive, true),
          eq(businessMemberships.isOwner, true),
        ),
      )
      .limit(1);

    if (!ownerMembership) {
      throw new ForbiddenException(
        'Only the active business owner can manage access',
      );
    }
  }

  private validateEndpointKey(endpointKey: string): void {
    if (!ENDPOINT_KEY_PATTERN.test(endpointKey)) {
      throw new BadRequestException('Invalid endpoint key');
    }
  }
}
