import { IsUUID } from 'class-validator';

export class ProvisionBusinessQueryDto {
  @IsUUID()
  requested_business_id!: string;
}
