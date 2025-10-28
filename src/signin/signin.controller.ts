import { Controller, Post, Body, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { LoginService } from './signin.service';

// Dto
import { SigninDto } from './dto';


@Controller('login')
export class LoginController { 
    constructor(private readonly loginService: LoginService ) {}

    @Post()
    @HttpCode(HttpStatus.OK)
    async login( @Body() dto: SigninDto ) {
        return this.loginService.login( dto );
    }
}