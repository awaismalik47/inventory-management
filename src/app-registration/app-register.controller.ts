import { Controller, Post, Body, Headers, UseGuards, HttpCode, HttpStatus, Req, UnauthorizedException } from "@nestjs/common";

// Services
import { AppRegistrationService } from "./app-register.service";

// Guards
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";

// Dto
import { ShopRegisterDto } from "./dto";

@Controller('registerShop')
@UseGuards(JwtAuthGuard)
export class RegisterShopController {

    constructor( private readonly appRegistrationService: AppRegistrationService ) {}

    @Post()
    async registerShop( 
        @Body() dto: ShopRegisterDto, @Req() req: Request
    ) {
        const userId = req?.['user']?.userId;
        if ( !userId ) {
            throw new UnauthorizedException('Unauthorized');
        }

        return await this.appRegistrationService.registerShop( dto, userId );
    }
}