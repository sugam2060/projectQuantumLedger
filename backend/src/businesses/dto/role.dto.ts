import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PERMISSION_KEYS } from '../../authorization';

const Trim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );

/** POST /businesses/:businessId/roles */
export class CreateRoleDto {
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  description?: string;

  /** Limits the role to one branch (fixed after creation). */
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(PERMISSION_KEYS.length)
  @IsIn(PERMISSION_KEYS, { each: true })
  permissions!: string[];
}

/** PATCH /businesses/:businessId/roles/:roleId (only the fields sent change). */
export class UpdateRoleDto {
  @IsOptional()
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  /** An empty string clears the description. */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(PERMISSION_KEYS.length)
  @IsIn(PERMISSION_KEYS, { each: true })
  permissions?: string[];
}
