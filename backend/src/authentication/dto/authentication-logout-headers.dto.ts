import { IsEnum } from 'class-validator';
import { ClientType } from './client-login.dto';

export class AuthenticationLogoutHeadersDto {
  @IsEnum(ClientType)
  clientType!: ClientType;
}
