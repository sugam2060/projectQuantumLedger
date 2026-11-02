import { IsOptional, IsString, MaxLength } from 'class-validator';

export class LogoutAllDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
