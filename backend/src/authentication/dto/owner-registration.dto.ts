import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
  IsUUID,
} from 'class-validator';

export class OwnerRegistrationDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  redeemCode!: string;

  @IsUUID()
  businessId!: string;

  @IsUUID()
  branchId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  terminalCode!: string;
}
