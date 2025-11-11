import { Injectable, InternalServerErrorException } from "@nestjs/common";

// Services
import { ProductService } from "src/products/product.service";
import { OrderService } from "src/orders/order.service";

// Models
import type { RestockPredictionModel } from "src/models/restock-prediction.model";
import type { IProductModel, IVariantModel } from "src/models/product.model";
import type { orderModel } from "src/models/order.model";

// Enums
import { UrgencyLevelEnum } from "src/core/enums";

@Injectable()
export class RestockPredictionService {

	constructor( 
		private readonly productService: ProductService,
		private readonly orderService: OrderService
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

			const predictions = this.generatePredictions( products, sevenDaysRangeSales, fourteenDaysRangeSales, thirtyDaysRangeSales, predictionDays );

			console.log(`[RestockPrediction] Generated ${predictions.length} predictions for store: ${store}`);

			return predictions;

		} catch ( error: any ) {
			console.error(`[RestockPrediction] Error generating predictions:`, error.message, error.stack);
			throw new InternalServerErrorException(`Failed to generate restock predictions: ${error.message}`);
		}
	}

	// Fetch data from services - fetches ALL products and orders without pagination
	// Optimized: Fetches both in parallel for faster execution
	private async fetchData( store: string, status: string ) {
		try {
			console.log(`[RestockPrediction] Fetching data for store: ${store}`);
			
			// Fetch products and orders in parallel since they're independent
			// Note: getAllProducts throws exceptions, getAllOrders returns error objects
			console.log(`[RestockPrediction] Starting parallel fetch of products and orders...`);
			const [productsResponse, ordersResponse] = await Promise.all([
				this.productService.getAllProducts( store, status ).catch(err => {
					console.error(`[RestockPrediction] Error fetching products:`, err.message, err.stack);
					return { error: err.message, products: null };
				}),
				this.orderService.getAllOrders( store ).catch(err => {
					console.error(`[RestockPrediction] Error fetching orders:`, err.message, err.stack);
					return { error: err.message, orders: null };
				})
			]);
			
			console.log(`[RestockPrediction] Completed parallel fetch. Products response received: ${!!productsResponse}, Orders response received: ${!!ordersResponse}`);

			// Check for errors in responses
			if ( productsResponse?.error ) {
				console.error(`[RestockPrediction] Products fetch error:`, productsResponse.error, productsResponse.message);
				return { products: null, orders: null };
			}
			
			// Orders error is not fatal - we can still generate predictions with zero sales
			if ( ordersResponse?.error ) {
				console.warn(`[RestockPrediction] Orders fetch error (will continue with empty orders):`, ordersResponse.error);
				if (ordersResponse.message) {
					console.warn(`[RestockPrediction] Orders error details:`, ordersResponse.message);
				}
			}

			// Validate data exists
			const products = productsResponse?.products || [];
			// If orders failed, use empty array so predictions can still be generated
			const orders = ordersResponse?.error ? [] : (ordersResponse?.orders || []);
			
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


	// Calculate sales data for a specific time period
	// Optimized: More efficient date filtering and calculations
	private async calculateSalesForPeriod( products: IProductModel[], orders: orderModel[], days: number ) {
		const cutoffDate     = this.getCutoffDate( days );
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


	// Get cutoff date for filtering orders
	private getCutoffDate( days: number ): Date {
		const cutoffDate = new Date();
		cutoffDate.setDate( cutoffDate.getDate() - days );
		return cutoffDate;
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
	private generatePredictions(products: IProductModel[], sevenDaysRangeSales: Map<number, any>, fourteenDaysRangeSales: Map<number, any>, thirtyDaysRangeSales: Map<number, any>, predictionDays: number): any[] {
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

				
				const prediction = this.createPrediction(
					product, 
					variant, 
					sevenDaysRangeData, 
					fourteenDaysRangeData, 
					thirtyDaysRangeData, 
					predictionDays
				);
				
				predictions.push( prediction );
			}
		}
		
		return predictions;
	}


	// Create a complete prediction for a variant
	private createPrediction( product: IProductModel, variant: IVariantModel, sevenDaysRange: any, fourteenDaysRange: any, thirtyDaysRange:any, predictionDays: number ): RestockPredictionModel {

		const availableStock = variant.available || 0;
		const incomingStock  = variant.incoming || 0;
		const totalInventory = availableStock + incomingStock;
	

		const recommendedRestockSevenDaysRange    = this.calculateRestockQuantity( sevenDaysRange.perDaySales, predictionDays,availableStock, incomingStock );
		const recommendedRestockFourteenDaysRange = this.calculateRestockQuantity( fourteenDaysRange.perDaySales, predictionDays,availableStock, incomingStock );
		const recommendedRestockThirtyDaysRange   = this.calculateRestockQuantity( thirtyDaysRange.perDaySales, predictionDays,availableStock, incomingStock );
		const recommendedAverageStock             = ( recommendedRestockSevenDaysRange + recommendedRestockFourteenDaysRange + recommendedRestockThirtyDaysRange ) / 3;

		return {
			// Basic info
			productImage: variant.imageSrc ? variant.imageSrc : product.imageUrl,
			productId: product.id,
			productName: product.title,
			variantId: variant.id,
			variantName: variant.title,
			sku: variant.sku,
			status: product.status,
			
			// Sales data
			sevenDaysRangeSales: sevenDaysRange.totalSales,
			fourteenDaysRangeSales: fourteenDaysRange.totalSales,
			thirtyDaysRangeSales: thirtyDaysRange.totalSales,
			perDaySoldSevenDaysRange: sevenDaysRange.perDaySales,
			perDaySoldFourteenDaysRange: fourteenDaysRange.perDaySales,
			perDaySoldThirtyDaysRange: thirtyDaysRange.perDaySales,
			
			// Stock info
			availableStock,
			incomingStock,
			totalInventory,
			
			// Restock recommendations
			recommendedRestockSevenDaysRange,
			recommendedRestockFourteenDaysRange,
			recommendedRestockThirtyDaysRange,

			// Average calculations
			recommendedAverageStock,
			// urgency level
			urgencyLevel: this.calculateUrgencyLevel( availableStock, sevenDaysRange.perDaySales ),
		};
	}


	// Calculate how much to restock based on sales velocity and current inventory
	private calculateRestockQuantity( perDaySales: number, predictionDays: number, availableStock: number, incomingStock: number ): number {
		const reorderQuantity  = perDaySales * predictionDays;

		if ( reorderQuantity < availableStock || ( reorderQuantity < availableStock + 1 ) ) {
			return 0;
		} else  {
			return reorderQuantity + Math.abs( reorderQuantity - availableStock );
		} 
	}


	// Calculate urgency level
	private calculateUrgencyLevel( availableStock: number, perDaySoldSevenDaysRange: number, leadTime: number = 15 ): UrgencyLevelEnum {

		if ( availableStock < 0 ) {
			return UrgencyLevelEnum.Critical;
		}

		if ( perDaySoldSevenDaysRange === 0 ) {
			return UrgencyLevelEnum.Low;
		}

		const daysOfStockLeft = availableStock / perDaySoldSevenDaysRange;

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
}