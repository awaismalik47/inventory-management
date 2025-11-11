import { Body, Controller, Headers, HttpCode, HttpStatus, Logger, Post } from '@nestjs/common';
import { OrderService } from '../orders/order.service';
import { ShopRegisterDto } from 'src/app-registration/dto';
import { ShopService } from 'src/shop/shop.service';

@Controller('webhooks')
export class WebhooksController {
	private readonly logger = new Logger(WebhooksController.name);

	constructor(
		private readonly orderService: OrderService, 
		private readonly shopService: ShopService,
	) {}

	@Post('orders/create')
	@HttpCode(HttpStatus.OK)
	async handleOrderCreate(
		@Body() orderData: any,
		@Headers() headers: Record<string, string | string[]>
	): Promise<void> {
		const shopDomain = this.extractShopDomain( headers );

		if ( !shopDomain ) {
			this.logger.warn('[handleOrderCreate] Received order webhook without shop header');
			return;
		}

		this.logger.debug(`[handleOrderCreate] Received order for shop ${shopDomain} (orderId: ${orderData?.id ?? 'unknown'})`);

		const shop = await this.shopService.findByShopifyDomain( shopDomain );
		if ( !shop ) {
			this.logger.warn('[handleOrderCreate] Shop not found');
			return;
		}

		try {
			await this.orderService.saveOrdersForShop( shop.shop, [orderData] );
			this.logger.log(`[handleOrderCreate] Stored order ${orderData?.id ?? 'unknown'} for shop ${shopDomain}`);
		} catch (error) {
			this.logger.error(
				`[handleOrderCreate] Failed to persist order for shop ${shopDomain}`,
				error instanceof Error ? error.stack : String(error),
			);
			// Swallow error to avoid webhook retries storm; Shopify expects 200
		}
	}


	private extractShopDomain(headers: Record<string, string | string[]>): string | null {
		console.log(headers);
		const headerKey = Object.keys(headers).find(
			key => key.toLowerCase() === 'x-shopify-shop-domain'
		);

		if (!headerKey) {
			return null;
		}

		const value = headers[headerKey];

		if (Array.isArray(value)) {
			return value[0] ?? null;
		}

		return value ?? null;
	}
}
