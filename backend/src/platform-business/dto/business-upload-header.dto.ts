import { Equals } from 'class-validator';

export class BusinessUploadHeaderDto {
  @Equals('web')
  clientType!: string;
}
