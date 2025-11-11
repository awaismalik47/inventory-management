import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { ShopService } from 'src/shop/shop.service';
import { orderModel } from 'src/models/order.model';

@Injectable()
export class OrderService {  
	
	private readonly GRAPHQL_PAGE_SIZE = 50;
    private readonly MAX_GRAPHQL_RETRIES = 5;
    private readonly GRAPHQL_RETRY_BASE_DELAY = 1000;

	
    constructor(
        private readonly httpService: HttpService,
        private readonly shopService: ShopService
    ) {}

    async getOrders( store: string, limit: string = '250' ): Promise<any> {
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


	async getAllOrders( store: string, days: number = 30): Promise<any> {
		const shop = await this.shopService.findByShop( store );

		if (!shop) {
			return {
				error: 'Shop not found. Please complete OAuth flow first.',
				instructions: 'Visit /shopify-oauth/init?shop=your-store.myshopify.com first'
			};
		}

		const accessToken = shop.accessToken as string;

		// Calculate the date N days ago
		const dateNDaysAgo = new Date();
		dateNDaysAgo.setDate(dateNDaysAgo.getDate() - days);
		const createdAtMin = dateNDaysAgo.toISOString();

		const searchQuery = `created_at:>=${createdAtMin}`;

		try {
			console.log(`[getAllOrders] Starting GraphQL fetch for last ${days} days for store: ${store} (since ${createdAtMin})`);

			const orderModels = await this.fetchOrdersUsingGraphQL(
				store,
				accessToken,
				searchQuery,
				'[getAllOrders]'
			);

			console.log(`[getAllOrders] Completed GraphQL fetch. Total normalized orders: ${orderModels.length}`);

			return {
				orders: orderModels,
				totalOrders: orderModels.length
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



	async getAllOrdersByRange( store: string, startDate: string, endDate: string ): Promise<any> {
		console.log(`[getAllOrdersByRange] Starting to fetch orders from ${startDate} to ${endDate} for store: ${store}`);
        if ( !store ) {
            return {
                error: 'Missing required parameter: store'
            };
        }

		if ( !startDate || !endDate ) {
            return {
                error: 'Missing required parameters: startDate and endDate'
            };
        }

		const parsedStart = new Date(startDate);
		const parsedEnd   = new Date(endDate);

		if ( isNaN(parsedStart.getTime()) || isNaN(parsedEnd.getTime()) ) {
			return {
				error: 'Invalid date range provided',
				message: `Unable to parse startDate (${startDate}) or endDate (${endDate}).`
			};
		}

		if ( parsedStart.getTime() > parsedEnd.getTime() ) {
			console.warn(`[getAllOrdersByRange] startDate is after endDate. Swapping values to maintain chronological order.`);
			const temp = parsedStart.getTime();
			parsedStart.setTime(parsedEnd.getTime());
			parsedEnd.setTime(temp);
		}

        const shop = await this.shopService.findByShop( store );
        if (!shop) {
            return {
                error: 'Shop not found. Please complete OAuth flow first.',
                instructions: 'Visit /shopify-oauth/init?shop=your-store.myshopify.com first'
            };
        }

		const accessToken     = shop.accessToken as string;
		const normalizedStart = parsedStart.toISOString();
		const normalizedEnd   = parsedEnd.toISOString();
		const dateQuery       = `created_at:>=${normalizedStart} AND created_at:<=${normalizedEnd}`;

		try {
			const orderModels = await this.fetchOrdersUsingGraphQL(
				store,
				accessToken,
				dateQuery,
				'[getAllOrdersByRange]'
			);

			return {
				orders: orderModels,
				totalOrders: orderModels.length,
				range: {
					startDate: normalizedStart,
					endDate: normalizedEnd
				}
			};
		} catch ( error: any ) {
			console.error(`[getAllOrdersByRange] Error fetching orders via GraphQL`, {
				message: error?.message,
				status: error?.response?.status,
				response: error?.response?.data
			});

			return {
				error: 'Failed to fetch orders using GraphQL',
				message: error?.response?.data ? JSON.stringify(error.response.data) : error?.message || 'Unknown error'
			};
		}
    }


	private async fetchOrdersUsingGraphQL(
		store: string,
		accessToken: string,
		searchQuery: string,
		logPrefix: string
	): Promise<orderModel[]> {
		const ordersQuery = `
		query OrdersByDate($first: Int!, $after: String, $searchQuery: String!) {
			orders(first: $first, after: $after, query: $searchQuery, sortKey: CREATED_AT, reverse: true) {
				edges {
					cursor
					node {
						id
						name
						createdAt
						displayFinancialStatus
						displayFulfillmentStatus
						lineItems(first: 100) {
							edges {
								cursor
								node {
									name
									title
									quantity
									variant {
										id
										title
									}
									product {
										id
										title
									}
								}
							}
						}
					}
				}
				pageInfo {
					hasNextPage
					endCursor
				}
			}
		}
		`;

		const rawOrders: any[] = [];
		let hasNextPage = true;
		let endCursor: string | null = null;
		let pageCount = 0;

		while ( hasNextPage ) {
			pageCount++;

			const variables = {
				first: this.GRAPHQL_PAGE_SIZE,
				after: endCursor,
				searchQuery
			};

			const data = await this.makeGraphQLRequest(
				store,
				accessToken,
				ordersQuery,
				variables
			);

			const ordersConnection = data?.orders;

			if ( !ordersConnection ) {
				console.warn(`${logPrefix} No orders connection returned for search query "${searchQuery}".`);
				break;
			}

			const edges = ordersConnection?.edges ?? [];

			console.log(`${logPrefix} GraphQL page ${pageCount}: fetched ${edges.length} edges.`);

			for ( const edge of edges ) {
				const orderNode = edge?.node;
				if ( orderNode ) {
					rawOrders.push( this.normalizeOrderForModel( orderNode ) );
				}
			}

			hasNextPage = ordersConnection?.pageInfo?.hasNextPage ?? false;
			endCursor  = hasNextPage ? ordersConnection?.pageInfo?.endCursor ?? null : null;

			if ( hasNextPage ) {
				// Small delay to respect rate limits
				await new Promise(resolve => setTimeout(resolve, 300));
			}
		}

		console.log(`${logPrefix} GraphQL fetch completed. Total orders transformed: ${rawOrders.length}`);

		return this.getAllOrderModel( rawOrders );
	}



    private async makeGraphQLRequest(
        store: string,
        accessToken: string,
        query: string,
        variables: Record<string, any>,
        retryCount = 0
    ): Promise<any> {
        const url = `https://${store}/admin/api/${process.env.API_VERSION}/graphql.json`;

        try {
            const response = await lastValueFrom(
                this.httpService.post(
                    url,
                    { query, variables },
                    {
                        headers: {
                            'X-Shopify-Access-Token': accessToken,
                            'Content-Type': 'application/json',
                        }
                    }
                )
            );

            if (response.data?.errors?.length) {
                throw new Error(`GraphQL errors: ${JSON.stringify(response.data.errors)}`);
            }

            return response.data?.data;
        } catch ( error: any ) {
            const status = error?.response?.status;
			
            if ( status === 429 && retryCount < this.MAX_GRAPHQL_RETRIES ) {
                const headers = error.response?.headers ?? {};
                const retryAfterHeader =
                    headers['retry-after'] ??
                    headers['Retry-After'] ??
                    headers['x-shopify-retry-after'] ??
                    headers['X-Shopify-Retry-After'];

                const retryAfterMs = retryAfterHeader
                    ? (parseInt(String(retryAfterHeader), 10) * 1000) + 500
                    : this.GRAPHQL_RETRY_BASE_DELAY * Math.pow(2, retryCount);

                console.warn(
                    `[makeGraphQLRequest] HTTP 429 received. Retrying in ${retryAfterMs}ms (attempt ${retryCount + 1}/${this.MAX_GRAPHQL_RETRIES})`
                );

                await new Promise(resolve => setTimeout(resolve, retryAfterMs));

                return this.makeGraphQLRequest(store, accessToken, query, variables, retryCount + 1);
            }

            throw error;
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


	private normalizeOrderForModel(order: any) {
		const lineItemsConnection = order?.lineItems;
		const lineItems = Array.isArray(lineItemsConnection?.edges)
			? lineItemsConnection.edges.map((edge: any) => {
				const node = edge?.node ?? {};
				const variant = node?.variant ?? {};
				const product = node?.product ?? {};

				return {
					product_id: this.extractNumericId(product?.id),
					name: node?.name ?? node?.title ?? '',
					product_exists: !!product?.id,
					variant_id: this.extractNumericId(variant?.id),
					quantity: node?.quantity ?? 0,
					variant_title: variant?.title ?? node?.title ?? ''
				};
			})
			: [];

		return {
			id: this.extractNumericId(order?.id),
			order_number: order?.orderNumber ?? order?.name ?? '',
			number: order?.orderNumber ?? order?.name ?? '',
			created_at: order?.createdAt ?? '',
			financial_status: order?.displayFinancialStatus ?? '',
			fulfillment_status: order?.displayFulfillmentStatus ?? '',
			line_items: lineItems
		};
	}

    private extractNumericId(gid: string | null | undefined): number | null {
        if (!gid || typeof gid !== 'string') {
            return null;
        }

        const segments = gid.split('/');
        const lastSegment = segments[segments.length - 1];
        const numeric = Number(lastSegment);

        return Number.isFinite(numeric) ? numeric : null;
    }
}