import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PASSWORD_MAX_LENGTH } from '../../authentication';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** POST .../invitations: up to 20 addresses, one role (and optional branch). */
export class CreateInvitationsDto {
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? value.map((email) =>
          typeof email === 'string' ? email.trim().toLowerCase() : email,
        )
      : value,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsEmail({}, { each: true })
  @MaxLength(254, { each: true })
  emails!: string[];

  @IsUUID()
  roleId!: string;

  /** Branch to join. Required (and forced) on branch routes. */
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

/** GET /invitations/preview?token= */
export class InvitationTokenQueryDto {
  @IsString()
  @Matches(TOKEN_PATTERN, { message: 'token is malformed' })
  token!: string;
}

/**
 * POST /invitations/accept. Existing accounts send their password; new accounts
 * also send a name (and the password becomes theirs).
 */
export class AcceptInvitationDto {
  @IsString()
  @Matches(TOKEN_PATTERN, { message: 'token is malformed' })
  token!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  /** Leave the current business (not as owner) to join this one. */
  @IsOptional()
  @IsBoolean()
  confirmResignation?: boolean;
}
