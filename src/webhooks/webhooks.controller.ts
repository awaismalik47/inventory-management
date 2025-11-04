import { Controller, Post, Body, Headers, HttpCode, HttpStatus, Logger } from '@nestjs/common';

// Services
import { WebhooksService } from './webhooks.service';
import { ProductService } from '../products/product.service';

// Gateways
import { EventsGateway } from 'src/events/events.gateway';

@Controller('webhooks')
export class WebhooksController {
	// private readonly logger = new Logger( WebhooksController.name );

	// constructor(
	// 	private readonly webhooksService: WebhooksService,
	// 	private readonly productService: ProductService,
	// 	private readonly eventsGateway: EventsGateway,
	// ) {}


	// @Post('orders/create')
	// @HttpCode(HttpStatus.OK)
	// async handleOrderCreate(@Body() orderData: any, @Headers() headers: any) {
	// 	this.logger.log('Received order/create webhook');
	// 	try {
	// 		// Process the new order
	// 		const shop = headers['x-shopify-shop-domain'] as string;
	// 		this.eventsGateway.emitToShop( shop, 'orderCreated', orderData);
	// 		this.logger.log(`Successfully emitted order created event to shop: ${shop}`);
	// 	} catch (error) {
	// 		this.logger.error('Error processing order/create webhook:', error);
	// 		throw error;
	// 	}
	// }


	// @Post('products/update')
	// @HttpCode(HttpStatus.OK)
	// async handleProductUpdate(@Body() productData: any, @Headers() headers: any) {
	// 	this.logger.log('Received products/update webhook');
	// 	try {
	// 		// Process the product update
	// 		const shop = headers['x-shopify-shop-domain'] as string;
	// 		this.eventsGateway.emitToShop(shop, 'productUpdated', productData);
	// 		this.logger.log(`Successfully emitted product updated event to shop: ${shop}`);
	// 	} catch (error) {
	// 		this.logger.error('Error processing products/update webhook:', error);
	// 		throw error;
	// 	}
	// }


	// @Post('products/delete')
	// @HttpCode(HttpStatus.OK)
	// async handleProductDelete(@Body() productData: any, @Headers() headers: any) {
	// 	this.logger.log('Received products/delete webhook');
	// 	try {
	// 		const shop = headers['x-shopify-shop-domain'] as string;
	// 		this.eventsGateway.emitToShop(shop, 'productDeleted', productData);
	// 		this.logger.log(`Successfully emitted product deleted event to shop: ${shop}`);
	// 	} catch (error) {
	// 		this.logger.error('Error processing products/delete webhook:', error);
	// 		throw error;
	// 	}
	// }


	// @Post('products/create')
	// @HttpCode(HttpStatus.OK)
	// async handleProductCreate(@Body() productData: any, @Headers() headers: any) {
	// 	this.logger.log('Received products/create webhook');
	// 	try {
	// 		const shop = headers['x-shopify-shop-domain'] as string;
	// 		this.eventsGateway.emitToShop(shop, 'productCreated', productData);
	// 		this.logger.log(`Successfully emitted product created event to shop: ${shop}`);
	// 	} catch (error) {
	// 		this.logger.error('Error processing products/create webhook:', error);
	// 		throw error;
	// 	}
	// }


	// @Post('inventory/items/update')
	// @HttpCode(HttpStatus.OK)
	// async handleInventoryUpdate(@Body() inventoryData: any, @Headers() headers: any) {
	// 	this.logger.log('Received inventory/items/update webhook');
	// 	try {
	// 		const shop = headers['x-shopify-shop-domain'] as string;
	// 		this.eventsGateway.emitToShop(shop, 'inventoryUpdated', inventoryData);
	// 		this.logger.log(`Successfully emitted inventory updated event to shop: ${shop}`);
	// 	} catch (error) {
	// 		this.logger.error('Error processing inventory/items/update webhook:', error);
	// 		throw error;
	// 	}
	// }


	// @Post('inventory/items/create')
	// @HttpCode(HttpStatus.OK)
	// async handleInventoryCreate(@Body() inventoryData: any, @Headers() headers: any) {
	// 	this.logger.log('Received inventory/items/create webhook');
	// 	try {
	// 		// Process new inventory item
	// 		const shop = headers['x-shopify-shop-domain'] as string;
	// 		this.eventsGateway.emitToShop(shop, 'inventoryCreated', inventoryData);
	// 		this.logger.log(`Successfully emitted inventory created event to shop: ${shop}`);
	// 	} catch (error) {
	// 		this.logger.error('Error processing inventory/items/create webhook:', error);
	// 		throw error;
	// 	}
	// }


	// @Post('inventory/items/delete')
	// @HttpCode(HttpStatus.OK)
	// async handleInventoryDelete(@Body() inventoryData: any, @Headers() headers: any) {
	// 	this.logger.log('Received inventory/items/delete webhook');
	// 	try {
	// 		// Process inventory item deletion
	// 		await this.productService.processInventoryDelete(inventoryData);
	// 		this.logger.log(`Successfully processed inventory delete: ${inventoryData.inventory_item_id}`);
	// 	} catch (error) {
	// 		this.logger.error('Error processing inventory/items/delete webhook:', error);
	// 		throw error;
	// 	}
  	// }


	// @Post('app/uninstalled')
	// @HttpCode(HttpStatus.OK)
	// async handleAppUninstalled(@Body() uninstallData: any, @Headers() headers: any) {
	// this.logger.log('Received app/uninstalled webhook');
	// 	try {
	// 		// Clean up shop data when app is uninstalled
	// 		await this.webhooksService.handleAppUninstall( uninstallData );
	// 		const shop = headers['x-shopify-shop-domain'] as string;
	// 		this.eventsGateway.emitToShop(shop, 'appUninstalled', uninstallData);
	// 		this.logger.log(`Successfully emitted app uninstalled event to shop: ${shop}`);
	// 	} catch (error) {
	// 		this.logger.error('Error processing app/uninstalled webhook:', error);
	// 		throw error;
	// 	}
	// }
}