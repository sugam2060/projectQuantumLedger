import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ActivateTerminalDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  terminalCode!: string;
}
