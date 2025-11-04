import { IsString, IsNotEmpty } from 'class-validator';

export class ShopRegisterDto {
    @IsString()
    @IsNotEmpty()  
    shop: string;

    @IsString()
    @IsNotEmpty()
    accessToken: string;
}