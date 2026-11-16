import { Equals } from 'class-validator';

export class OwnerRegistrationHeadersDto {
  @Equals('web')
  clientType!: string;
}
