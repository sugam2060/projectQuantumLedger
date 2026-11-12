import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ClientType } from './clientLogin.dto';

export class PlatformUserLoginDto {
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(320)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password!: string;

  @IsOptional()
  @IsEnum(ClientType)
  client_type?: ClientType;
}
