import { Injectable, NotFoundException } from '@nestjs/common';
import type { CreateRoleDto, UpdateRoleDto } from './dto';
import { RolesRepository } from './roles.repository';
import type { RoleView } from './types';
import { assertOk } from './utils/outcome.util';
import { roleKeyFromName } from './utils/role-key.util';

const ROLE_MESSAGES = {
  not_found: 'Role was not found',
  invalid: 'Unknown branch or permission',
  conflict: 'A role with this name already exists',
} as const;

/**
 * Custom roles of a business. Every rule (system roles are read-only, a role
 * only grants what its editor holds, roles in use cannot be deleted) is
 * enforced by the SQL functions; this service shapes input and output.
 */
@Injectable()
export class RolesService {
  constructor(private readonly repository: RolesRepository) {}

  listPermissions(userId: string) {
    return this.repository.listPermissions(userId);
  }

  listRoles(userId: string, businessId: string): Promise<RoleView[]> {
    return this.repository.listRoles(userId, businessId);
  }

  async getRole(
    userId: string,
    businessId: string,
    roleId: string,
  ): Promise<RoleView> {
    const [role] = await this.repository.listRoles(userId, businessId, roleId);
    if (!role) throw new NotFoundException(ROLE_MESSAGES.not_found);
    return role;
  }

  async createRole(
    userId: string,
    businessId: string,
    dto: CreateRoleDto,
  ): Promise<RoleView> {
    const { outcome, roleId } = await this.repository.saveRole(
      userId,
      businessId,
      {
        roleId: null,
        key: roleKeyFromName(dto.name),
        name: dto.name,
        description: dto.description || null,
        branchId: dto.branchId ?? null,
        permissions: dto.permissions,
      },
    );
    assertOk(outcome, ROLE_MESSAGES);
    return this.getRole(userId, businessId, roleId as string);
  }

  async updateRole(
    userId: string,
    businessId: string,
    roleId: string,
    dto: UpdateRoleDto,
  ): Promise<RoleView> {
    const result = await this.repository.saveRole(userId, businessId, {
      roleId,
      key: dto.name === undefined ? null : roleKeyFromName(dto.name),
      name: dto.name ?? null,
      description: dto.description ?? null,
      branchId: null,
      permissions: dto.permissions ?? null,
    });
    assertOk(result.outcome, ROLE_MESSAGES);
    return this.getRole(userId, businessId, roleId);
  }

  async deleteRole(
    userId: string,
    businessId: string,
    roleId: string,
  ): Promise<void> {
    assertOk(await this.repository.deleteRole(userId, businessId, roleId), {
      ...ROLE_MESSAGES,
      conflict: 'The role is assigned to members or open invitations',
    });
  }
}
