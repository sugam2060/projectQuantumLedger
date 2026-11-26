import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isPermissionKey } from '../authorization';
import type { UpdateMemberDto } from './dto';
import { MembersRepository } from './members.repository';
import type { MemberDetailView, MemberView } from './types';
import { assertOk } from './utils/outcome.util';

const MEMBER_MESSAGES = {
  not_found: 'Member was not found',
  invalid: 'The role or branch cannot be used for this member',
} as const;

/**
 * Members of a business. On branch routes (`scopeBranchId`) everything is
 * limited to that branch. The anti-escalation rules live in SQL:
 * - nobody changes their own membership or the owner's;
 * - nobody manages someone who holds a permission they lack;
 * - nobody assigns a role (or allow-override) granting what they lack;
 * - a branch-level role works only at its branch.
 */
@Injectable()
export class MembersService {
  constructor(private readonly repository: MembersRepository) {}

  list(
    userId: string,
    businessId: string,
    scopeBranchId?: string,
  ): Promise<MemberView[]> {
    return this.repository.list(userId, businessId, scopeBranchId);
  }

  async get(
    userId: string,
    businessId: string,
    targetUserId: string,
    scopeBranchId?: string,
  ): Promise<MemberDetailView> {
    const [member] = await this.repository.list(
      userId,
      businessId,
      scopeBranchId,
      targetUserId,
    );
    if (!member) throw new NotFoundException(MEMBER_MESSAGES.not_found);
    const extra = await this.repository.overridesAndPermissions(
      userId,
      businessId,
      targetUserId,
    );
    return { ...member, ...extra };
  }

  async update(
    userId: string,
    businessId: string,
    targetUserId: string,
    dto: UpdateMemberDto,
    scopeBranchId?: string,
  ): Promise<MemberDetailView> {
    const changeRole = dto.roleId !== undefined;
    const changeBranch = dto.branchId !== undefined;
    if (!changeRole && !changeBranch) {
      throw new BadRequestException('Send roleId, branchId or both');
    }
    const outcome = await this.repository.update(
      userId,
      businessId,
      scopeBranchId,
      targetUserId,
      {
        changeRole,
        roleId: dto.roleId ?? null,
        changeBranch,
        branchId: dto.branchId ?? null,
      },
    );
    assertOk(outcome, MEMBER_MESSAGES);
    return this.get(userId, businessId, targetUserId, scopeBranchId);
  }

  async end(
    userId: string,
    businessId: string,
    targetUserId: string,
    scopeBranchId?: string,
  ): Promise<void> {
    assertOk(
      await this.repository.end(
        userId,
        businessId,
        scopeBranchId,
        targetUserId,
      ),
      MEMBER_MESSAGES,
    );
  }

  async setOverride(
    userId: string,
    businessId: string,
    targetUserId: string,
    permissionKey: string,
    effect: 'allow' | 'deny',
  ): Promise<MemberDetailView> {
    this.assertPermissionKey(permissionKey);
    assertOk(
      await this.repository.setOverride(
        userId,
        businessId,
        targetUserId,
        permissionKey,
        effect,
      ),
      MEMBER_MESSAGES,
    );
    return this.get(userId, businessId, targetUserId);
  }

  async clearOverride(
    userId: string,
    businessId: string,
    targetUserId: string,
    permissionKey: string,
  ): Promise<void> {
    this.assertPermissionKey(permissionKey);
    assertOk(
      await this.repository.clearOverride(
        userId,
        businessId,
        targetUserId,
        permissionKey,
      ),
      { ...MEMBER_MESSAGES, not_found: 'Override was not found' },
    );
  }

  private assertPermissionKey(key: string): void {
    if (!isPermissionKey(key)) {
      throw new BadRequestException('Unknown permission');
    }
  }
}
