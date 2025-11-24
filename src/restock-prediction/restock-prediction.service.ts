import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";

// Services
import { ProductService } from "src/products/product.service";
import { OrderService } from "src/orders/order.service";

// Models
import type { RestockPredictionModel, RestockPredictionRangeSummaryModel } from "src/models/restock-prediction.model";
import type { IProductModel, IVariantModel } from "src/models/product.model";
import type { orderModel } from "src/models/order.model";
import { TrackIncoming, TrackIncomingDocument } from "src/schema/incoming-history.schema";

// Enums
import { UrgencyLevelEnum } from "src/core/enums";


@Injectable()
export class RestockPredictionService {

	private readonly productsCache = new Map<string, { products: IProductModel[]; lastUpdated: number }>();

	constructor( 
		private readonly productService: ProductService,
		private readonly orderService: OrderService,
		@InjectModel(TrackIncoming.name) private trackIncomingModel: Model<TrackIncomingDocument>
	) {}

	async generateRestockPredictions(
		store     : string, 
		futureDays: string = '15',
		status    : string = 'active'
	): Promise<RestockPredictionModel[]> {
		try {	
			console.log(`[RestockPrediction] Generating predictions for store: ${store}`);

			// Get data from services - fetches ALL products and orders automatically
			const { products, orders } = await this.fetchData( store, status );

			this.updateProductsCache( store, status, products );
			
			if ( !products || products.length === 0 ) {
				console.warn(`[RestockPrediction] No products available for store: ${store}`);
				return [];
			}

			// Ensure orders is always an array (even if empty) - predictions can still be generated
			const validOrders = Array.isArray(orders) ? orders : [];
			
			if ( validOrders.length === 0 ) {
				console.warn(`[RestockPrediction] No orders available for store: ${store} - predictions will use zero sales data`);
			}

			// Parse parameters
			const predictionDays = parseInt( futureDays );

			// Optimized: Calculate sales for both time ranges in parallel since they're independent
			const [ sevenDaysRangeSales, fourteenDaysRangeSales, thirtyDaysRangeSales ] = await Promise.all([
				this.calculateSalesForPeriod( products, validOrders, 7 ),
				this.calculateSalesForPeriod( products, validOrders, 14 ),
				this.calculateSalesForPeriod( products, validOrders, 30 )
			]);

			const predictions = await this.generatePredictions( products, sevenDaysRangeSales, fourteenDaysRangeSales, thirtyDaysRangeSales, predictionDays, store );

			console.log(`[RestockPrediction] Generated ${predictions.length} predictions for store: ${store}`);

			return predictions;

		} catch ( error: any ) {
			console.error(`[RestockPrediction] Error generating predictions:`, error.message, error.stack);
			throw new InternalServerErrorException(`Failed to generate restock predictions: ${error.message}`);
		}
	}


	private getCutoffDateUTC(days: number): Date {
		const now = new Date();
		const cutoff = new Date(Date.UTC(
			now.getUTCFullYear(),
			now.getUTCMonth(),
			now.getUTCDate() - (days - 1),
			0, 0, 0, 0
		));
		return cutoff;
	}


	async generateCustomRangeSummary(
		store     : string,
		futureDays: string = '15',
		startDate : string,
		endDate   : string,
		status    : string = 'active'
	): Promise<RestockPredictionRangeSummaryModel[]> {
		try {
			console.log(`[RestockPrediction] Generating custom range summary for store: ${store}`);

			const ordersResponse = await this.orderService.getAllOrdersByRange(store, startDate, endDate);

			if ( ordersResponse?.error ) {
				console.warn(`[RestockPrediction] Unable to generate custom range summary due to order fetch error: ${ordersResponse.error}`);
				return [];
			}

			const orders = Array.isArray(ordersResponse?.orders) ? ordersResponse.orders : [];

			if ( orders.length === 0 ) {
				console.warn(`[RestockPrediction] No orders available for custom range in store: ${store}`);
				return [];
			}

			const products = await this.getProductsForSummary(store, status);

			if (!products.length) {
				console.warn(`[RestockPrediction] No products available for store: ${store}`);
				return [];
			}

			const parsedStart = ordersResponse?.range?.startDate ? new Date(ordersResponse.range.startDate) : new Date(startDate);
			const parsedEnd = ordersResponse?.range?.endDate ? new Date(ordersResponse.range.endDate) : new Date(endDate);
			const rangeDays = this.calculateRangeDayCount(parsedStart, parsedEnd);
			const predictionDays = this.parsePredictionDays(futureDays);

			const salesByVariant = new Map<number, number>();

			for (const order of orders) {
				if ( order?.variantId ) {
					const existingSales = salesByVariant.get(order.variantId) || 0;
					salesByVariant.set( order.variantId, existingSales + (order.quantity || 0) );
				}
			}

			const summaries: RestockPredictionRangeSummaryModel[] = [];

			for ( const product of products ) {
				for (const variant of product.variants) {
					const totalSales = salesByVariant.get(variant.id) || 0;
					const soldPerDay = rangeDays > 0 ? totalSales / rangeDays : 0;
					const recommendedRestock = await this.calculateRestockQuantity(
						variant.id,
						soldPerDay,
						predictionDays,
						variant.available || 0,
						variant.incoming || 0,
						store
					);

					summaries.push({
						productId: product.id,
						productName: product.title,
						sku: variant.sku,
						variantId: variant.id,
						variantName: variant.title,
						totalSales,
						soldPerDay,
						recommendedRestock
					});
				}
			}

			console.log(`[RestockPrediction] Generated ${summaries.length} custom range summaries for store: ${store}`);
			return summaries;
		} catch (error: any) {
			console.error(`[RestockPrediction] Error generating custom range summary:`, error.message, error.stack);
			throw new InternalServerErrorException(`Failed to generate custom range summary: ${error.message}`);
		}
	}

	
	// Fetch data from services - fetches ALL products and orders without pagination
	// Optimized: Fetches both in parallel for faster execution
	private async fetchData( store: string, status: string ) {
		try {
			console.log(`[RestockPrediction] Fetching data for store: ${store}`);
			
			// Fetch products and orders in parallel since they're independent
			// Note: getAllProducts throws exceptions, getAllOrders returns error objects
			console.log(`[RestockPrediction] Starting parallel fetch of products and stored orders...`);
			const [productsResponse, ordersResponse] = await Promise.all([
				this.productService.getAllProducts( store, status, false, false ).catch(err => {
					console.error(`[RestockPrediction] Error fetching products:`, err.message, err.stack);
					return { error: err.message, products: null };
				}),
				this.orderService.getStoredOrders( store ).catch(err => {
					console.error(`[RestockPrediction] Error fetching stored orders:`, err.message, err.stack);
					return { error: err.message, orders: null };
				})
			]);
			
			console.log(`[RestockPrediction] Completed parallel fetch. Products response received: ${!!productsResponse}, Orders response received: ${!!ordersResponse}`);

			// Check for errors in responses
			if ( productsResponse?.error ) {
				console.error(`[RestockPrediction] Products fetch error:`, productsResponse.error, productsResponse.message);
				return { products: null, orders: null };
			}
			
			const ordersError = ordersResponse && 'error' in ordersResponse ? ordersResponse.error : null;
			if ( ordersError ) {
				console.warn(`[RestockPrediction] Stored orders fetch error (will continue with empty orders):`, ordersError);
			}

			// Validate data exists
			const products = productsResponse?.products || [];
			// If orders failed, use empty array so predictions can still be generated
			const orders = ordersError ? [] : (ordersResponse?.orders || []);
			
			console.log(`[RestockPrediction] Received products response: ${products.length} products`);
			console.log(`[RestockPrediction] Received orders response: ${orders.length} orders`);
			console.log(`[RestockPrediction] Fetched ${products.length} products and ${orders.length} orders`);

			if ( !products || products.length === 0 ) {
				console.warn(`[RestockPrediction] No products found for store: ${store}`);
			}

			if ( !orders || orders.length === 0 ) {
				console.warn(`[RestockPrediction] No orders found for store: ${store}`);
			}

			return {
				products: products as IProductModel[],
				orders  : orders as orderModel[]
			};
		} catch (error: any) {
			console.error(`[RestockPrediction] Error in fetchData:`, error.message);
			return { products: null, orders: null };
		}
	}


	private getProductsCacheKey(store: string, status: string): string {
		return `${store?.toLowerCase?.() || store}::${status?.toLowerCase?.() || status}`;
	}


	private updateProductsCache(store: string, status: string, products: IProductModel[] | null | undefined): void {
		if (!products || !Array.isArray(products) || products.length === 0) {
			return;
		}

		const cacheKey = this.getProductsCacheKey(store, status);
		this.productsCache.set(cacheKey, { products, lastUpdated: Date.now() });
	}


	private async getProductsForSummary(store: string, status: string): Promise<IProductModel[]> {
		const cacheKey = this.getProductsCacheKey(store, status);
		const cachedEntry = this.productsCache.get(cacheKey);

		if (cachedEntry && Array.isArray(cachedEntry.products) && cachedEntry.products.length > 0) {
			console.log(`[RestockPrediction] Using cached products for store: ${store}`);
			return cachedEntry.products;
		}

		console.log(`[RestockPrediction] No cached products found for store: ${store}. Fetching fresh data...`);
		const { products } = await this.fetchData(store, status);
		this.updateProductsCache(store, status, products);

		return Array.isArray(products) ? products : [];
	}


	// Calculate sales data for a specific time period
	// Optimized: More efficient date filtering and calculations
	private async calculateSalesForPeriod( products: IProductModel[], orders: orderModel[], days: number ) {
		const cutoffDate     = this.getCutoffDateUTC( days );
		const cutoffTime     = cutoffDate.getTime();
		const salesByVariant = new Map<number, number>();
		
		// Optimized: Single loop to filter and calculate sales
		for (const order of orders) {
			const orderTime = new Date(order.createdAt).getTime();
			if (orderTime >= cutoffTime && order.variantId) {
				const currentSales = salesByVariant.get(order.variantId) || 0;
				salesByVariant.set(order.variantId, currentSales + order.quantity);
			}
		}
		
		return this.createSalesData(products, salesByVariant, days);
	}


	private calculateRangeDayCount(startDate: Date, endDate: Date): number {
		const start = startDate instanceof Date ? new Date(startDate) : new Date();
		const end = endDate instanceof Date ? new Date(endDate) : new Date();

		if (isNaN(start.getTime()) || isNaN(end.getTime())) {
			return 1;
		}

		const adjustedEnd = end.getTime() >= start.getTime() ? end : start;

		const diffMs = adjustedEnd.getTime() - start.getTime();
		const MS_PER_DAY = 1000 * 60 * 60 * 24;

		return Math.max(1, Math.floor(diffMs / MS_PER_DAY) + 1);
	}


	private parsePredictionDays(futureDays: string | null | undefined): number {
		const parsed = parseInt(`${futureDays ?? ''}`, 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : 15;
	}


	private createSalesData( products: IProductModel[], salesByVariant: Map<number, number>, days: number ): Map<number, any> {
		const salesDataMap = new Map<number, any>();
		
		for (const product of products) {
			for (const variant of product.variants) {
				const totalSales  = salesByVariant.get( variant.id ) || 0;
				const perDaySales = totalSales / days;
				
				salesDataMap.set(variant.id, {
					variantId  : variant.id,
					productId  : product.id,
					productName: product.title,
					variantName: variant.title,
					totalSales,
					perDaySales
				});
			}
		}
		
		return salesDataMap;
	}


	// Generate final predictions with restock recommendations
	// Optimized: Uses Map for O(1) lookups instead of array.find()
	private async generatePredictions(products: IProductModel[], sevenDaysRangeSales: Map<number, any>, fourteenDaysRangeSales: Map<number, any>, thirtyDaysRangeSales: Map<number, any>, predictionDays: number, shop: string): Promise<any[]> {
		const predictions: any[] = [];
		
		// Pre-define default sales data to avoid repeated object creation
		const defaultSalesData = {
			totalSales : 0,
			perDaySales: 0
		};
		
		for ( const product of products ) {
			for ( const variant of product.variants ) {
				const sevenDaysRangeData = sevenDaysRangeSales.get(variant.id) || defaultSalesData;
				const fourteenDaysRangeData = fourteenDaysRangeSales.get(variant.id) || defaultSalesData;
				const thirtyDaysRangeData = thirtyDaysRangeSales.get(variant.id) || defaultSalesData;

				
				const prediction = await this.createPrediction(
					product, 
					variant, 
					sevenDaysRangeData, 
					fourteenDaysRangeData, 
					thirtyDaysRangeData, 
					predictionDays,
					shop
				);
				
				predictions.push( prediction );
			}
		}
		
		return predictions;
	}


	// Create a complete prediction for a variant
	private async createPrediction( product: IProductModel, variant: IVariantModel, sevenDaysRange: any, fourteenDaysRange: any, thirtyDaysRange:any, predictionDays: number, shop: string ): Promise<RestockPredictionModel> {

		const availableStock = variant.available || 0;
		const incomingStock  = variant.incoming || 0;
		const totalInventory = availableStock + incomingStock;
	

		const recommendedRestockSevenDaysRange    = await this.calculateRestockQuantity( variant?.id,sevenDaysRange.perDaySales, predictionDays,availableStock, incomingStock, shop );
		const recommendedRestockFourteenDaysRange = await this.calculateRestockQuantity( variant?.id, fourteenDaysRange.perDaySales, predictionDays,availableStock, incomingStock, shop );
		const recommendedRestockThirtyDaysRange   = await this.calculateRestockQuantity( variant?.id, thirtyDaysRange.perDaySales, predictionDays,availableStock, incomingStock, shop );

		let remainingDaysToReachIncomingStock = 0;
		if ( incomingStock > 0 ) {
			const { daysPassed, incomingQuantityForSinglePO } = await this.getRemainingDaysForIncoming( variant?.id, shop );
			remainingDaysToReachIncomingStock   = daysPassed;
		}
		const recommendedAverageStock             = ( recommendedRestockSevenDaysRange + recommendedRestockFourteenDaysRange + recommendedRestockThirtyDaysRange ) / 3;

		return {
			// Basic info
			productImage: variant?.imageSrc ? variant?.imageSrc : product?.imageUrl,
			productId: product?.id,
			productName: product?.title,
			variantId: variant?.id,
			variantName: variant.title,
			sku: variant?.sku,
			status: product?.status,
			
			// Sales data
			sevenDaysRangeSales: sevenDaysRange?.totalSales,
			fourteenDaysRangeSales: fourteenDaysRange?.totalSales,
			thirtyDaysRangeSales: thirtyDaysRange?.totalSales,
			perDaySoldSevenDaysRange: sevenDaysRange?.perDaySales,
			perDaySoldFourteenDaysRange: fourteenDaysRange?.perDaySales,
			perDaySoldThirtyDaysRange: thirtyDaysRange?.perDaySales,
			
			// Stock info
			availableStock,
			incomingStock,
			totalInventory,

			// Incoming stock info
			remainingDaysToReachIncomingStock,
			
			// Restock recommendations
			recommendedRestockSevenDaysRange,
			recommendedRestockFourteenDaysRange,
			recommendedRestockThirtyDaysRange,

			// Average calculations
			recommendedAverageStock,
			// urgency level
			urgencyLevel: this.calculateUrgencyLevel( availableStock, incomingStock, sevenDaysRange.perDaySales ),
		};
	}


	// Calculate how much to restock based on sales velocity and current inventory
	private async calculateRestockQuantity( variantId: number, perDaySales: number, predictionDays: number, availableStock: number, incomingStock: number, shop: string ): Promise<number> {
		const shipmentDays    = 15;
		const reorderQuantity = perDaySales * predictionDays;
		if ( incomingStock > 0 ) {
			const { daysPassed, incomingQuantityForSinglePO } = await this.getRemainingDaysForIncoming( variantId, shop );

			// Calculate the remaining days for incoming stock
			const daysRemainingForIncomingStock  = shipmentDays - daysPassed; 
			// Calculate the total consumption during shipment
			const totalConsumptionDuringShipment = perDaySales * daysRemainingForIncomingStock; 

			if ( availableStock >= totalConsumptionDuringShipment && incomingQuantityForSinglePO >= reorderQuantity ) {
				return 0;
			} 

			if ( availableStock >= totalConsumptionDuringShipment && availableStock >= reorderQuantity ) {
				return 0;
			}

			if ( incomingQuantityForSinglePO >= reorderQuantity || incomingQuantityForSinglePO > ( reorderQuantity - 1 ) ) {
				return 0;
			}

			return reorderQuantity;
			
		}  else {
			if ( reorderQuantity < availableStock || ( reorderQuantity < availableStock + 1 ) ) {
				return 0; 
			} else  {
				return reorderQuantity +reorderQuantity - availableStock ;
			} 
		}
	}


	// Calculate urgency level
	private calculateUrgencyLevel( availableStock: number, incomingStock: number, perDaySoldSevenDaysRange: number, leadTime: number = 15 ): UrgencyLevelEnum {

		if ( availableStock < 0 ) {
			return UrgencyLevelEnum.Critical;
		}

		if ( perDaySoldSevenDaysRange === 0 ) {
			return UrgencyLevelEnum.Low;
		}

		const daysOfStockLeft = ( availableStock+incomingStock ) / perDaySoldSevenDaysRange;

		if ( daysOfStockLeft <= leadTime ) {
		  return UrgencyLevelEnum.Critical;
		} else if ( daysOfStockLeft <= leadTime + 7 ) { // total 22 days of stock left
			return UrgencyLevelEnum.High;
		} else if ( daysOfStockLeft <= 30 ) {
			return UrgencyLevelEnum.Medium;
		} else {
			return UrgencyLevelEnum.Low;
		}
		
	}

	private async getRemainingDaysForIncoming( variantId: number, shop: string ): Promise<{ daysPassed: number, incomingQuantityForSinglePO: number }> {
		const variantFromLocalDb = await this.trackIncomingModel.findOne({ variantId, shop });

		console.log( variantFromLocalDb, 'variantFromLocalDb' );
		if ( variantFromLocalDb?.incomingHistory?.length === 1 ) {
			const date = variantFromLocalDb?.incomingHistory[0]?.date;
			const incomingQuantityForSinglePO = variantFromLocalDb?.incomingHistory[0]?.quantity;
			if ( date ) {
				const lastChanged = new Date(date);
				const now = Date.now();

				// Calculate the difference in milliseconds
				const diffMs = now - lastChanged.getTime();

				// Convert milliseconds to full days
				const daysPassed = Math.floor( diffMs / (1000 * 60 * 60 * 24) );

				return { daysPassed, incomingQuantityForSinglePO };
			}
		} 
		return { daysPassed: 0, incomingQuantityForSinglePO: 0 };
	}
}