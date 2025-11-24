import { IsEmail, IsNotEmpty, IsString, MinLength, MaxLength } from "class-validator";

export class SigninDto {
    @IsEmail()
    @IsNotEmpty()
    email: string;

    @IsString()
    @IsNotEmpty()
    @MinLength(6)
    @MaxLength(255)
    password: string;
}