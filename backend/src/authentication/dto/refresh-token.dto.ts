import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body of refresh and logout requests. Native clients send the refresh token here;
 * browser clients send it as the httpOnly `refresh_token` cookie instead.
 */
export class RefreshTokenDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  refreshToken?: string;
}
