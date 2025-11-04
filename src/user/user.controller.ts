import { Body, Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { UserService } from "./user.service";
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