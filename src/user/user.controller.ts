import { Controller, Get, Query, UseGuards } from "@nestjs/common";

// Services
import { UserService } from "./user.service";

// Guards
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";

@Controller('user')
@UseGuards(JwtAuthGuard)
export class UserController {

    constructor( private readonly userService: UserService ) {}

    
    @Get()
    async getUserDetails( @Query() query: { userId: string } ) {
        return await this.userService.findById( query.userId );
    }
}