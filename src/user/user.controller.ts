import { Controller, Post, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { UserService } from "./user.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";

@Controller('user')
@UseGuards(JwtAuthGuard)
export class UserController {

    constructor( private readonly userService: UserService ) {}

    @Post()
    async getUserDetails( @Req() req ) {
        // User info is automatically attached by JwtAuthGuard
        const userId = req.user.userId;
        return this.userService.findById( userId );
    }
}