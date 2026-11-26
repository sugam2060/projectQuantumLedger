import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PLATFORM_ROLES, type PlatformRole } from '../../authorization';

export class InvitePlatformUserDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  @Matches(/\S/)
  name!: string;

  @IsEmail()
  @MaxLength(320)
  email!: string;

  /** Platform role of the new account (default `support`). */
  @IsOptional()
  @IsIn(PLATFORM_ROLES)
  role?: PlatformRole;
}
