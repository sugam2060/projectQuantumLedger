import {IsString, IsEmail, IsNotEmpty,IsBoolean,IsOptional, MinLength} from 'class-validator'


export class UserLoginDTO {
    @IsString()
    @IsNotEmpty()
    @IsEmail()
    readonly email: string;

    @IsString()
    @IsNotEmpty()
    @MinLength(8)
    readonly password: string

    @IsOptional()
    @IsBoolean()
    readonly remember: boolean

}