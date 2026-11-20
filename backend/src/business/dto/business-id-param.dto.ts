import { IsUUID } from 'class-validator';

export class BusinessIdParamDto {
  @IsUUID()
  businessId!: string;
}
