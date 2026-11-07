import { UserLoginDTO } from './userLogin.dto';
import { IsEnum, IsOptional } from 'class-validator';

export enum ClientType {
  WEB = 'web',
  MOBILE = 'mobile',
  DESKTOP = 'desktop',
}

export class ClientLoginDTO extends UserLoginDTO {
  @IsOptional()
  @IsEnum(ClientType)
  readonly client_type?: ClientType;
}
