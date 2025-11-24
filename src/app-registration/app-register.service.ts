import { Injectable, UnauthorizedException } from "@nestjs/common";

// Services
import { ShopService } from "src/shop/shop.service";
import { WebhooksService } from "src/webhooks/webhooks.service";

// Dto
import { ShopRegisterDto } from "./dto";


@Injectable()
export class AppRegistrationService {
	constructor( 
		private readonly shopService: ShopService,
		private readonly webhooksService: WebhooksService,
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

			const shopDomain = await this.shopService.CheckShopExistsInShopify( dto.shop, dto.accessToken );
			if ( !shopDomain ) {
				throw new UnauthorizedException( 'Shop not found' );
			}

			console.log( '[AppRegistrationService] shopDomain', shopDomain );

			await this.shopService.upsertShop({ shop: dto.shop, accessToken: dto.accessToken, installedByUserId: userId, shopifyDomain: shopDomain.shop.myshopify_domain });
			
			// Register webhooks after saving shop data
			try {
				await this.webhooksService.registerAllWebHooks( dto.shop, dto.accessToken );
			} catch ( webhookError ) {
				console.error( '[AppRegistrationService] Failed to register webhooks during app registration:', webhookError );
  
			}
			
			return {
				message     : 'App is installed',
				shop        : dto?.shop,
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
				shop        : dto?.shop,
				userId      : userId,
				isInstalled : true,
				isAuthorized: true,
				shopData    : shop
			};
		} else {
			return {
				message     : 'App is installed by another user',
				shop        : dto?.shop,
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