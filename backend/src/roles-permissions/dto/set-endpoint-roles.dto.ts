import { ArrayNotEmpty, ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class SetEndpointRolesDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  roleIds!: string[];
}
