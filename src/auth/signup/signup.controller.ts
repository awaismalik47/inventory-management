import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';

// Services
import { SignupService } from './signup.service';

// Dto
import { SignupDto } from '../dto';


@Controller('signup')
export class SignupController { 
    constructor(private readonly signupService: SignupService ) {}

    @Post()
    @HttpCode( HttpStatus.CREATED )
    async signup( @Body() dto: SignupDto ) {
        return this.signupService.addUser( dto);
    }
}
