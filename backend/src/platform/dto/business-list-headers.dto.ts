import { IsIn } from 'class-validator';

export class BusinessListHeadersDto {
  @IsIn(['web', 'desktop', 'mobile'])
  clientType!: string;
}
