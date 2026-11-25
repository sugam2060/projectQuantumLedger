import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateBusinessDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  displayName?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2)
  country?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  postalCode?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  addressLine1?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(300)
  addressLine2?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  primaryContactNumber?: string;

  @IsOptional()
  @Transform(trimString)
  @IsEmail()
  @MaxLength(320)
  primaryContactEmail?: string;
}
