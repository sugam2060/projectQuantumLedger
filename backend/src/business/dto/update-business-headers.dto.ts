import { IsIn, IsString, Matches, MaxLength } from 'class-validator';

export class UpdateBusinessHeadersDto {
  @IsIn(['web', 'desktop', 'mobile'])
  clientType!: string;

  @IsString()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
  idempotencyKey!: string;
}
