import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../authentication';

/** POST /platform/users/invitations/accept */
export class AcceptPlatformInvitationDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/, { message: 'token is malformed' })
  token!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}
