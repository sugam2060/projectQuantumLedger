import { IsEnum, IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { ClientType } from './clientLogin.dto';

export class AuthenticationLoginHeadersDto {
  @IsOptional()
  @IsEnum(ClientType)
  clientType?: ClientType;

  @ValidateIf(
    (headers: AuthenticationLoginHeadersDto) =>
      (headers.clientType !== undefined &&
        headers.clientType !== ClientType.WEB) ||
      headers.terminalId !== undefined,
  )
  @IsUUID()
  terminalId?: string;
}
