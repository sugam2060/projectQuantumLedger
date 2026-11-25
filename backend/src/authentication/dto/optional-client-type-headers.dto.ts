import { IsEnum, IsOptional } from 'class-validator';
import { ClientType } from './client-login.dto';

/** An optional, but when present valid, X-Client-Type header. */
export class OptionalClientTypeHeadersDto {
  @IsOptional()
  @IsEnum(ClientType)
  clientType?: ClientType;
}
