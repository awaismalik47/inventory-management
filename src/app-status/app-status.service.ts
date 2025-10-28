import { Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ShopService } from "src/shop/shop.service";
import * as jwt from 'jsonwebtoken';

@Injectable()
export class AppStatusService {
    constructor( private readonly shopService: ShopService ) {}

    async getAppStatus( shopName: string, token: any ) {

        // Verify JWT token first
        if (!token) {
            throw new UnauthorizedException( 'No token provided' );
        }

        let decodedToken;
        try {
            decodedToken = jwt.verify( token, process.env.JWT_SECRET! );
        } catch ( error ) {
            throw new UnauthorizedException('Invalid token');
        }

        console.log('shopName', shopName);
        console.log('token', token);

        // Find shop in database
        const shop = await this.shopService.findByShop( shopName );
        
        // If shop doesn't exist, app is not installed
        if ( !shop ) {
            return {
                message        : 'App is not installed on this shop',
                shop           : shopName,
                userId         : decodedToken.userId,
                isInstalled    : false,
                installationUrl: process.env.SHOPIFY_APP_URL,
                shopData       : null
            };
        }


        // Check if the authenticated user owns this shop
        if ( shop?.installedByUserId?.toString() === decodedToken?.userId?.toString() ) {
            return {
                message     : 'App is installed by another user',
                shop        : shopName,
                userId      : decodedToken.userId,
                isInstalled : true,
                isAuthorized: true,
                shopData    : shop
            };
        } else {
            return {
                message     : 'App is installed by another user',
                shop        : shopName,
                userId      : decodedToken.userId,
                isInstalled : true,
                isAuthorized: false,
                shopData    : null
            };
        }

    }


    async getShopInstalledUser( userId: string ) {
        const shop = await this.shopService.findByInstalledByUserId( userId );
        return shop;
    }
}