import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class BusinessRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(240)
  legalName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  displayName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2)
  country!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  city!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  postalCode!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  addressLine1!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  addressLine2?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  primaryContactName!: string;

  @IsEmail()
  @MaxLength(320)
  primaryContactEmail!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  primaryContactPhone!: string;
}
