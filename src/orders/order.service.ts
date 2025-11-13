import { Injectable, UnauthorizedException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

// Services
import { ShopService } from 'src/shop/shop.service';

// Models
import { orderModel } from 'src/models/order.model';

// Schemas
import { OrderHistory, OrderHistoryDocument } from 'src/schema/order-history.schema';

@Injectable()
export class OrderService {  
	
	private readonly GRAPHQL_PAGE_SIZE = 50;
    private readonly MAX_GRAPHQL_RETRIES = 5;
    private readonly GRAPHQL_RETRY_BASE_DELAY = 1000;

	
    constructor(
        private readonly httpService: HttpService,
        private readonly shopService: ShopService,
        @InjectModel(OrderHistory.name)
        private readonly orderHistoryModel: Model<OrderHistoryDocument>
    ) {}


	async getAllOrdersByRange( store: string, startDate: string, endDate: string, persist: boolean = false ): Promise<any> {
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

			if ( persist ) {
				await this.persistOrdersForShop(store, orderModels);

				console.log(`[getAllOrdersByRange] Persisted ${orderModels.length} orders for store: ${store}`);
			}


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


	private async persistOrdersForShop(store: string, orders: orderModel[]): Promise<void> {
		if ( !orders?.length ) {
			return;
		}

		const operations = orders.map( order => {
			const orderCreatedAt = order.createdAt ? new Date(order.createdAt) : new Date();
			const dedupeKey = this.getOrderDedupeKey( order );

			return {
				updateOne: {
					filter: { shop: store, dedupeKey },
					update: {
						$set: {
							shop: store,
							dedupeKey,
							orderId: order.orderId,
							orderNumber: order.orderNumber,
							orderCreatedAt,
							financialStatus: order.financialStatus,
							fulfillmentStatus: order.fulfillmentStatus,
							productId: order.productId ?? null,
							productName: order.productName,
							productExists: order.productExists,
							variantId: order.variantId ?? null,
							quantity: order.quantity,
							variantTitle: order.variantTitle,
						}
					},
					upsert: true,
				}
			};
		});

		try {
			await this.orderHistoryModel.bulkWrite(operations, { ordered: false });
		} catch (error) {
			console.error('[persistOrdersForShop] Failed to upsert orders', error);
			throw error;
		}

		await this.deleteOrdersOlderThan(store, 30);
	}


	private getOrderDedupeKey(order: orderModel): string {
		const orderId = order.orderId ?? 'order';
		const variantId = order.variantId ?? 'variant';
		const productId = order.productId ?? 'product';
		const productName = order.productName ?? 'name';

		return `${orderId}:${variantId}:${productId}:${productName}`;
	}

	private async deleteOrdersOlderThan(store: string, days: number): Promise<void> {
		const cutoffDate = new Date();
		cutoffDate.setDate(cutoffDate.getDate() - days);

		await this.orderHistoryModel.deleteMany({
			shop: store,
			orderCreatedAt: { $lt: cutoffDate }
		});
	}


	async getStoredOrders( store: string,days: number = 30 ): Promise<{ orders: orderModel[]; totalOrders: number }> {

		if ( !store ) {
			throw new UnauthorizedException('Missing store parameter.');
		}

		const shop = await this.shopService.findByShop( store );

		if (!shop) {
			throw new UnauthorizedException('Shop not found. Please complete OAuth flow first.');
		}

		await this.deleteOrdersOlderThan( store, days );

		const cutoffDate = new Date();
		cutoffDate.setDate( cutoffDate.getDate() - days );

		const docs = await this.orderHistoryModel
			.find({
				shop: store,
				orderCreatedAt: { $gte: cutoffDate }
			})
			.lean()
			.exec();

		const orders = docs.map(doc => this.mapHistoryToOrderModel(doc));

		return {
			orders,
			totalOrders: orders.length
		};
	}


	async saveOrdersForShop(store: string, rawOrders: any[]): Promise<void> {
		if (!rawOrders?.length) {
			return;
		}

		const shop = await this.shopService.findByShop(store);
		if (!shop) {
			throw new UnauthorizedException('Shop not found. Please complete OAuth flow first.');
		}

		const orders = this.getAllOrderModel(rawOrders);
		if (!orders.length) {
			return;
		}

		await this.persistOrdersForShop(store, orders);
	}

	async pruneStoredOrders(days: number = 30, store?: string): Promise<void> {
		if (store) {
			await this.deleteOrdersOlderThan(store, days);
			return;
		}

		const shops: string[] = await this.orderHistoryModel.distinct('shop');
		await Promise.all(shops.map(shop => this.deleteOrdersOlderThan(shop, days)));
	}


	async getOrderFromLocalDb(store: string, orderId: string): Promise<orderModel | UnauthorizedException> {
		const order = await this.orderHistoryModel.findOne({ shop: store, orderId });
		console.log('order', order);
		if ( !order ) {
			throw new UnauthorizedException('Order not found');
		}
		return this.mapHistoryToOrderModel(order);
	}


	private mapHistoryToOrderModel(history: any): orderModel {
		return {
			orderId: history.orderId ?? 0,
			orderNumber: history.orderNumber ?? '',
			createdAt: history.orderCreatedAt
				? new Date(history.orderCreatedAt).toISOString()
				: '',
			financialStatus: history.financialStatus ?? '',
			fulfillmentStatus: history.fulfillmentStatus ?? '',
			productId: history.productId ?? 0,
			productName: history.productName ?? '',
			productExists: history.productExists ?? false,
			variantId: history.variantId ?? 0,
			quantity: history.quantity ?? 0,
			variantTitle: history.variantTitle ?? ''
		};
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
					node {
						id
						name
						createdAt
						displayFinancialStatus
						displayFulfillmentStatus
						lineItems(first: 100) {
							edges {
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

    private extractNumericId( gid: string | null | undefined ): number | null {
        if ( !gid || typeof gid !== 'string' ) {
            return null;
        }

        const segments = gid.split('/');
        const lastSegment = segments[segments.length - 1];
        const numeric = Number(lastSegment);

        return Number.isFinite(numeric) ? numeric : null;
    }
}