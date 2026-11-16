import { IsEnum } from 'class-validator';
import { ClientType } from './clientLogin.dto';

export class AuthenticationLogoutHeadersDto {
  @IsEnum(ClientType)
  clientType!: ClientType;
}
