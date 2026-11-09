import { Matches, MaxLength } from 'class-validator';

export class EndpointKeyParamsDto {
  @MaxLength(120)
  @Matches(/^[a-z][a-z0-9_.:-]{1,119}$/)
  endpointKey!: string;
}
