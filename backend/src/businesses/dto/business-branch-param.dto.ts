import { IsUUID } from 'class-validator';
import { BusinessIdParamDto } from './business-id-param.dto';

/** `:businessId/branches/:branchId` route parameters. */
export class BusinessBranchParamDto extends BusinessIdParamDto {
  @IsUUID()
  branchId!: string;
}
