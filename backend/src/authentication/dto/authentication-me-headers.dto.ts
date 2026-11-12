import { IsEnum, IsUUID } from 'class-validator';
import { ClientType } from './clientLogin.dto';

export class AuthenticationMeHeadersDto {
  @IsEnum(ClientType)
  clientType!: ClientType;

  @IsUUID()
  terminalId!: string;
}
