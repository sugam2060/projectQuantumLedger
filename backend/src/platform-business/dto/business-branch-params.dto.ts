import { IsUUID } from 'class-validator';

export class BusinessBranchParamsDto {
  @IsUUID()
  businessId!: string;
}
