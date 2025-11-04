import { Controller, Post, Body, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { SignupService } from './signup.service';
import type { SignupDataModel } from 'src/models/user.model';
import { SignupDto } from './dto';


@Controller('signup')
export class SignupController { 
    constructor(private readonly signupService: SignupService ) {}

    @Post()
    @HttpCode( HttpStatus.CREATED )
    async signup( @Body() dto: SignupDto ) {
        return this.signupService.addUser( dto);
    }
}
