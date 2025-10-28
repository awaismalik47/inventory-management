import { Controller, Post, Body, Headers, UseGuards } from "@nestjs/common";
import { AppStatusService } from "./app-status.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";

@Controller('appstatus')
@UseGuards(JwtAuthGuard)
export class AppStatusController {

    constructor( private readonly appStatusService: AppStatusService ) {}

    @Post()
    async getAppStatus( 
        @Body() body: { shop: string },
        @Headers('authorization') authHeader: string
    ) {
        // Use token from body first, fallback to header
        const token = authHeader?.replace('Bearer ', '') || null;
        console.log('token', token);
        return await this.appStatusService.getAppStatus( body.shop, token );
    }
}