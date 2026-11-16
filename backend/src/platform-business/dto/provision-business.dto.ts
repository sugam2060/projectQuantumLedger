import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ProvisionBusinessDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  pan!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  ownerEmail?: string;
}
