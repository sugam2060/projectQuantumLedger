import { IsIn, IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { PERMISSION_KEYS } from '../../authorization';

/**
 * PATCH /businesses/:businessId/members/:userId. Send `roleId`, `branchId` or
 * both; `branchId: null` makes the member business-wide.
 */
export class UpdateMemberDto {
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @ValidateIf((dto: UpdateMemberDto) => dto.branchId !== null)
  @IsOptional()
  @IsUUID()
  branchId?: string | null;
}

/** PUT .../members/:userId/overrides/:permissionKey */
export class SetOverrideDto {
  @IsIn(['allow', 'deny'])
  effect!: 'allow' | 'deny';
}

/** Path of an override route. */
export class OverrideParamsDto {
  @IsUUID()
  userId!: string;

  @IsIn(PERMISSION_KEYS)
  permissionKey!: string;
}
