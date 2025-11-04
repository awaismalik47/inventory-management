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
        const accessToken = shop.accessToken;
        

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


    /**
     * Fetch orders from the last N days (default: 30 days)
     * Uses REST API pagination with page_info to fetch all pages
     * 
     * How it works:
     * 1. Shopify REST API allows max 250 orders per request
     * 2. We fetch 250 orders at a time using page_info pagination
     * 3. We continue looping until no more pages are available
     * 4. All orders are accumulated in allOrders array
     * 
     * @param store - Store domain
     * @param days - Number of days to look back (default: 30)
     */
    async getAllOrders(store: string, days: number = 30): Promise<any> {
        const shop = await this.shopService.findByShop( store );

        if (!shop) {
            return {
                error: 'Shop not found. Please complete OAuth flow first.',
                instructions: 'Visit /shopify-oauth/init?shop=your-store.myshopify.com first'
            };
        }
        const accessToken = shop.accessToken;
        const limit = 250; // Maximum allowed by Shopify REST API
        const allOrders: any[] = [];
        let pageInfo: string | null = null;
        let hasNextPage = true;
        let pageCount = 0;

        // Calculate the date N days ago
        const dateNDaysAgo = new Date();
        dateNDaysAgo.setDate(dateNDaysAgo.getDate() - days);
        // Format as ISO 8601 (Shopify expects this format: YYYY-MM-DDTHH:mm:ssZ)
        const created_at_min = dateNDaysAgo.toISOString();

        try {
            console.log(`[getAllOrders] Starting to fetch orders from last ${days} days for store: ${store} (since ${created_at_min})`);
            while (hasNextPage) {
                pageCount++;
                
                // Build URL based on whether we're using page_info or not
                // Note: When using page_info, Shopify doesn't allow status, fulfillment_status, or created_at_min params
                let url: string;
                if (pageInfo) {
                    // When using page_info, remove all filter params (they're encoded in page_info)
                    url = `https://${store}/admin/api/${process.env.API_VERSION}/orders.json?limit=${limit}&page_info=${encodeURIComponent(pageInfo)}`;
                } else {
                    // First page - include status, fulfillment_status, and created_at_min
                    url = `https://${store}/admin/api/${process.env.API_VERSION}/orders.json?limit=${limit}&status=any&fulfillment_status=any&created_at_min=${encodeURIComponent(created_at_min)}`;
                }

                const ordersResponse = await lastValueFrom(
                    this.httpService.get(url, {
                        headers: {
                            'X-Shopify-Access-Token': accessToken
                        }
                    })
                );

                const orders = ordersResponse.data.orders || [];
                allOrders.push(...orders);

                console.log(`[getAllOrders] Fetched page ${pageCount}: ${orders.length} orders (Total so far: ${allOrders.length})`);

                // Check for pagination link in headers
                const linkHeader = ordersResponse.headers?.['link'] || ordersResponse.headers?.['Link'];
                if (linkHeader) {
                    // Parse Link header to get next page_info
                    // Link header format: <url?page_info=xxx>; rel="next"
                    const nextLink = linkHeader.split(',').find((link: string) => link.includes('rel="next"'));
                    if (nextLink) {
                        const pageInfoMatch = nextLink.match(/page_info=([^&>"]+)/);
                        pageInfo = pageInfoMatch ? decodeURIComponent(pageInfoMatch[1]) : null;
                        hasNextPage = !!pageInfo;
                    } else {
                        hasNextPage = false;
                    }
                } else {
                    // If no link header, check if we got fewer than limit (means last page)
                    hasNextPage = orders.length === limit;
                }

                // Reduced delay: Shopify REST API allows 2 requests/second for most plans
                // 500ms delay allows 2 requests/second, respecting rate limits
                if (hasNextPage) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
            
            console.log(`[getAllOrders] Completed fetching all orders. Total orders: ${allOrders.length}`);

            return {
                orders: this.getAllOrderModel( allOrders ),
                totalOrders: allOrders.length
            };

        } catch (error: any) {
            console.error(`[getAllOrders] Error details:`, {
                message: error?.message,
                response: error?.response?.data,
                status: error?.response?.status,
                url: error?.config?.url
            });
            return {
                error: 'Failed to fetch orders',
                message: error?.response?.data ? JSON.stringify(error.response.data) : error?.message || 'Unknown error'
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