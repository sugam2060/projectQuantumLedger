import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ClientType } from './clientLogin.dto';

export class AuthenticationLoginHeadersDto {
  @IsOptional()
  @IsEnum(ClientType)
  clientType?: ClientType;

  @IsUUID()
  terminalId!: string;
}
