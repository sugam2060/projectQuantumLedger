import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ClientType } from './clientLogin.dto';

export class PlatformRefreshHeadersDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  refreshToken?: string;

  @IsEnum(ClientType)
  clientType!: ClientType;
}
