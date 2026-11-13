import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsUUID } from 'class-validator';
import { ClientType } from './clientLogin.dto';

export class AuthenticationMeHeadersDto {
  @IsEnum(ClientType)
  clientType!: ClientType;

  @IsUUID()
  terminalId!: string;

  @Transform(({ value }: { value: unknown }) => {
    if (value === undefined || value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
    return value;
  })
  @IsBoolean()
  initialLoad = true;
}
