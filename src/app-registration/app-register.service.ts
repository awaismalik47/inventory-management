import { Injectable, InternalServerErrorException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ShopService } from "src/shop/shop.service";
import { WebhooksService } from "src/webhooks/webhooks.service";
import { ProductService } from "src/products/product.service";
import { ShopRegisterDto } from "./dto";


@Injectable()
export class AppRegistrationService {
    constructor( 
        private readonly shopService: ShopService,
        private readonly webhooksService: WebhooksService,
        private readonly productService: ProductService
    ) {}

    async registerShop( dto: ShopRegisterDto, userId: string ) {

        const shopExists = await this.shopService.CheckShopExistsInShopify( dto.shop, dto.accessToken );
        if ( !shopExists.valid ) {
            throw new UnauthorizedException( shopExists.error );
        }

        // Find shop in database
        const shop = await this.shopService.findByShop( dto.shop );
        
        // If shop doesn't exist, add shop to database and register webhooks
        if ( !shop ) {

            await this.shopService.upsertShop({ shop: dto.shop, accessToken: dto.accessToken, installedByUserId: userId });
            
            // // Register webhooks after saving shop data
            // try {
            //     await this.webhooksService.registerAllWebHooks(dto.shop, dto.accessToken);
            // } catch (webhookError) {
            //     throw new InternalServerErrorException('Failed to register webhooks');
            //     // Don't fail the flow if webhook registration fails
            // }
            
            return {
                message     : 'App is installed',
                shop        : dto.shop,
                userId      : userId,
                isInstalled : true,
                isAuthorized: true,
                shopData    : null
            };
        }


        // Check if the authenticated user owns this shop
        if ( shop && shop?.installedByUserId?.toString() === userId?.toString() ) {
            return {
                message     : 'App is installed by another user',
                shop        : dto.shop,
                userId      : userId,
                isInstalled : true,
                isAuthorized: true,
                shopData    : shop
            };
        } else {
            return {
                message     : 'App is installed by another user',
                shop        : dto.shop,
                userId      : userId,
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