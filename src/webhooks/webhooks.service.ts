import { Injectable } from '@nestjs/common';
import { ShopService } from 'src/shop/shop.service';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { WebhookTopicEnum } from 'src/core/enums';

@Injectable()
export class WebhooksService {
	constructor( private readonly shopService: ShopService, private readonly httpService: HttpService ) {}

		async registerAllWebHooks( shopDomain: string , accessToken: string ) {
			const webhooks = [
				{
				  topic: WebhookTopicEnum.OrdersCreate,
				  address: `${process.env.API_URL}/webhooks/orders/create`,
				},
				{
				  topic: WebhookTopicEnum.ProductsUpdate,
				  address: `${process.env.API_URL}/webhooks/products/update`,
				},
				{
				  topic: WebhookTopicEnum.ProductsDelete,
				  address: `${process.env.API_URL}/webhooks/products/delete`,
				},
				{
				  topic: WebhookTopicEnum.ProductsCreate,
				  address: `${process.env.API_URL}/webhooks/products/create`,
				},
				{
				  topic: WebhookTopicEnum.AppUninstalled,
				  address: `${process.env.API_URL}/webhooks/app/uninstalled`,
				},
				{
					topic: WebhookTopicEnum.InventoryItemsUpdate,
					address: `${process.env.API_URL}/webhooks/inventory/items/update`,
				},
				{
					topic: WebhookTopicEnum.InventoryItemsCreate,
					address: `${process.env.API_URL}/webhooks/inventory/items/create`,
				},
				{
					topic: WebhookTopicEnum.InventoryItemsDelete,
					address: `${process.env.API_URL}/webhooks/inventory/items/delete`,
				},
			  ];

			for ( const webhook of webhooks ) {
				await this.registerWebhook( shopDomain, accessToken, webhook.topic, webhook.address );
			}
		}


		private async registerWebhook(
			shopDomain: string,
			accessToken: string,
			topic: string,
			address: string,
		) {
			const url = `https://${shopDomain}/admin/api/${process.env.API_VERSION}/webhooks.json`;
				const webhookData = {
					webhook: {
					topic,
					address,
					format: 'json',
				},
			};
		
			try {
				const response = await lastValueFrom(
				this.httpService.post(url, webhookData, {
					headers: {
						'X-Shopify-Access-Token': accessToken,
						'Content-Type': 'application/json',
					},
				}),
				);
			  	console.log(`Registered webhook: ${topic}`);

			}	catch (error) {
				console.error(`Failed to register webhook for ${topic}`, error.response?.data || error);
			}
		}


		async handleAppUninstall( uninstallData: any ) {
			try {
				// Remove shop data from database when app is uninstalled
				await this.shopService.deleteShop( uninstallData.domain );
			} catch ( error ) {
				console.error(`Failed to clean up data for uninstalled shop: ${uninstallData.domain}`, error);
				throw error;
			}
		}
}