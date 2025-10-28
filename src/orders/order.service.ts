import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { ShopService } from 'src/shop/shop.service';
import { orderModel } from 'src/models/order.model';

@Injectable()
export class OrderService {
    constructor(
        private readonly httpService: HttpService,
        private readonly shopService: ShopService
    ) {}

    async getOrders(store: string, limit: string = '250'): Promise<any> {
        const shop = await this.shopService.findByShop( store );

        if (!shop) {
            return {
                error: 'Shop not found. Please complete OAuth flow first.',
                instructions: 'Visit /shopify-oauth/init?shop=your-store.myshopify.com first'
            };
        }
        const accessToken = shop.accessToken || process.env.SHOPIFY_ACCESS_TOKEN;

        try {
            const ordersResponse = await lastValueFrom(
                this.httpService.get(`https://${store}/admin/api/${process.env.API_VERSION}/orders.json?limit=${limit}&status=any&fulfillment_status=any`, {
                    headers: {
                        'X-Shopify-Access-Token': accessToken
                    }
                })
            );

            return {
                orders: this.getAllOrderModel( ordersResponse.data.orders ),
                totalOrders: ordersResponse.data.orders.length
            }

        } catch (error) {
            return {
                error: 'Failed to fetch orders',
                message: error.response?.data || error.message
            };
        }
    }


    getAllOrderModel( orders: any ): orderModel[] {
        if ( !orders ) return [];

        const orderModels: orderModel[] = [];

        for ( const order of orders ) {
            // Check if order has line_items
            if ( order.line_items && Array.isArray( order.line_items ) ) {
                // Create a separate orderModel for each line item
                for ( const lineItem of order.line_items ) {
                    const orderModel: orderModel = {
                        orderId: order.id,
                        orderNumber: order.order_number || order.number,
                        createdAt: order.created_at,
                        financialStatus: order.financial_status,
                        fulfillmentStatus: order.fulfillment_status,
                        productId: lineItem.product_id,
                        productName: lineItem.name,
                        productExists: lineItem.product_exists,
                        variantId: lineItem.variant_id,
                        quantity: lineItem.quantity,
                        variantTitle: lineItem.variant_title,
                    };
                    orderModels.push( orderModel );
                }
            }
        }

        return orderModels;
    }
}