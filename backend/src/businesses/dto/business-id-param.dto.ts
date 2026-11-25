import { IsUUID } from 'class-validator';

/** `:businessId` route parameter. */
export class BusinessIdParamDto {
  @IsUUID()
  businessId!: string;
}
