import { Equals, IsString, MaxLength, Matches } from 'class-validator';

export class ProvisionBusinessHeadersDto {
  @Equals('web')
  clientType!: string;

  @IsString()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
  idempotencyKey!: string;
}
