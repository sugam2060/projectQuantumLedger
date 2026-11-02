import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RefreshDto {
  @IsOptional()
  @IsString()
  @MinLength(40)
  @MaxLength(80)
  refreshToken?: string;
}
