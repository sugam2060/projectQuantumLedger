import { IsUUID } from 'class-validator';

export class BusinessIdParamDto {
  @IsUUID()
  businessId!: string;
}

export class BusinessBranchParamDto extends BusinessIdParamDto {
  @IsUUID()
  branchId!: string;
}
