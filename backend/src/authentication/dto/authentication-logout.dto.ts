import { IsOptional, IsString, MinLength } from 'class-validator';

export class AuthenticationLogoutDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  refreshToken?: string;
}
