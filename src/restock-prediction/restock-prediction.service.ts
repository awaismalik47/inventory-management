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
	private readonly urgencyPriority: Record<UrgencyLevelEnum, number> = {
		[UrgencyLevelEnum.Critical]: 4,
		[UrgencyLevelEnum.High]    : 3,
		[UrgencyLevelEnum.Medium]  : 2,
		[UrgencyLevelEnum.Low]     : 1,
	};

	constructor( 
		private readonly productService: ProductService,
		private readonly orderService: OrderService
	) {}

	async generateRestockPredictions(
		store     : string, 
		rangeDays1: string = '7',
		rangeDays2: string = '30',
		futureDays: string = '15',
		urgency   : UrgencyLevelEnum | null = null,
	): Promise<RestockPredictionModel[]> {
		try {	
			console.log(`[RestockPrediction] Generating predictions for store: ${store}`);

			// Get data from services - fetches ALL products and orders automatically
			const { products, orders } = await this.fetchData( store );
			
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
			const shortRangeDays = parseInt(rangeDays1);
			const longRangeDays  = parseInt(rangeDays2);
			const predictionDays = parseInt(futureDays);

			// Optimized: Calculate sales for both time ranges in parallel since they're independent
			const [shortRangeSales, longRangeSales] = await Promise.all([
				this.calculateSalesForPeriod( products, validOrders, shortRangeDays ),
				this.calculateSalesForPeriod( products, validOrders, longRangeDays )
			]);

			const predictions = this.generatePredictions( products, shortRangeSales, longRangeSales, predictionDays );

			console.log(`[RestockPrediction] Generated ${predictions.length} predictions for store: ${store}`);

			if ( urgency ) {
				const filtered = this.sortPredictionsByUrgency( predictions, urgency );
				console.log(`[RestockPrediction] Filtered to ${filtered.length} predictions with urgency: ${urgency}`);
				return filtered;
			}
			
			return predictions;

		} catch ( error: any ) {
			console.error(`[RestockPrediction] Error generating predictions:`, error.message, error.stack);
			throw new InternalServerErrorException(`Failed to generate restock predictions: ${error.message}`);
		}
	}


	// Fetch data from services - fetches ALL products and orders without pagination
	// Optimized: Fetches both in parallel for faster execution
	private async fetchData(store: string) {
		try {
			console.log(`[RestockPrediction] Fetching data for store: ${store}`);
			
			// Fetch products and orders in parallel since they're independent
			// Note: getAllProducts throws exceptions, getAllOrders returns error objects
			const [productsResponse, ordersResponse] = await Promise.all([
				this.productService.getAllProducts( store ).catch(err => {
					console.error(`[RestockPrediction] Error fetching products:`, err.message);
					return { error: err.message, products: null };
				}),
				this.orderService.getAllOrders( store ).catch(err => {
					console.error(`[RestockPrediction] Error fetching orders:`, err.message);
					return { error: err.message, orders: null };
				})
			]);

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
			
			console.log(`[RestockPrediction] Fetched ${products.length} products and ${orders.length} orders`);

			if (!products || products.length === 0) {
				console.warn(`[RestockPrediction] No products found for store: ${store}`);
			}

			if (!orders || orders.length === 0) {
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
		const cutoffDate     = this.getCutoffDate(days);
		const cutoffTime     = cutoffDate.getTime(); // Convert to timestamp once
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
		cutoffDate.setDate(cutoffDate.getDate() - days);
		return cutoffDate;
	}


	// Removed redundant methods - logic moved to calculateSalesForPeriod for optimization


	// Create sales data structure for all variants
	// Optimized: Uses Map for O(1) lookup instead of array.find()
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
	private generatePredictions(products: IProductModel[], shortRangeSales: Map<number, any>, longRangeSales: Map<number, any>, predictionDays: number): any[] {
		const predictions: any[] = [];
		
		// Pre-define default sales data to avoid repeated object creation
		const defaultSalesData = {
			totalSales : 0,
			perDaySales: 0
		};
		
		for (const product of products) {
			for (const variant of product.variants) {
				const shortRangeData = shortRangeSales.get(variant.id) || defaultSalesData;
				const longRangeData  = longRangeSales.get(variant.id) || defaultSalesData;
				
				const prediction = this.createPrediction(
					product, 
					variant, 
					shortRangeData, 
					longRangeData, 
					predictionDays
				);
				
				predictions.push( prediction );
			}
		}
		
		return predictions;
	}


	private sortPredictionsByUrgency( predictions: RestockPredictionModel[], urgency: UrgencyLevelEnum | null ): RestockPredictionModel[] {
		const filteredPredictions = urgency
			? predictions.filter(prediction => prediction.urgencyLevel === urgency)
			: predictions;

		return filteredPredictions.sort(
			(a, b) => this.urgencyPriority[b.urgencyLevel] - this.urgencyPriority[a.urgencyLevel]
		);
	}


	// Removed findSalesData - now using Map.get() directly in generatePredictions


	// Create a complete prediction for a variant
	private createPrediction( product: IProductModel, variant: IVariantModel, shortRange: any, longRange: any, predictionDays: number ): RestockPredictionModel {
		const availableStock = variant.available || 0;
		const incomingStock  = variant.incoming || 0;
		const totalInventory = availableStock + incomingStock;
		
		const averagePerDaySales = (shortRange.perDaySales + longRange.perDaySales) / 2;
		const expectedSales      = averagePerDaySales * predictionDays;
		
		const recommendedAverageStock = Math.max( 0, expectedSales - totalInventory);
		return {
			// Basic info
			productImage: variant.imageSrc ? variant.imageSrc : product.imageUrl,
			productId: product.id,
			productName: product.title,
			variantId: variant.id,
			variantName: variant.title,
			sku: variant.sku,
			
			// Sales data
			shortRangeSales: shortRange.totalSales,
			longRangeSales: longRange.totalSales,
			perDaySoldShortRange: shortRange.perDaySales,
			perDaySoldLongRange: longRange.perDaySales,
			
			// Stock info
			availableStock,
			incomingStock,
			totalInventory,
			
			// Average calculations
			recommendedAverageStock: Math.ceil(recommendedAverageStock),
			
			// Restock recommendations
			recommendedRestockShortRange: this.calculateRestockQuantity( shortRange.perDaySales, predictionDays, availableStock, incomingStock ),
			recommendedRestockLongRange: this.calculateRestockQuantity( longRange.perDaySales, predictionDays, availableStock, incomingStock ),

			// urgency level
			urgencyLevel: this.calculateUrgencyLevel( recommendedAverageStock ),
		};
	}


	// Calculate how much to restock based on sales velocity and current inventory
	private calculateRestockQuantity(perDaySales: number, predictionDays: number, availableStock: number, incomingStock: number): number {
		console.log(`[RestockPrediction] Calculating restock quantity for perDaySales: ${perDaySales}, predictionDays: ${predictionDays}, availableStock: ${availableStock}, incomingStock: ${incomingStock}`);
		const expectedSales  = perDaySales * predictionDays;
		const totalInventory = availableStock + incomingStock;
		const restockNeeded  = Math.max(0, expectedSales - totalInventory);
		
		return Math.ceil( restockNeeded ); // Round up to avoid stockouts
	}


	// Calculate urgency level
	private calculateUrgencyLevel( recommendedAverageStock: number ): UrgencyLevelEnum {
		if ( recommendedAverageStock >= 20 ) return UrgencyLevelEnum.Critical;
		if ( recommendedAverageStock >= 10 ) return UrgencyLevelEnum.High;
		if ( recommendedAverageStock >= 5 )  return UrgencyLevelEnum.Medium;
		return UrgencyLevelEnum.Low;
	}


	async getProducts( store: string, limit: string = '50' ): Promise<any> {
		return await this.productService.getProducts(store, limit);
	}


	async getOrders( store: string, limit: string = '50' ): Promise<any> {
		return await this.orderService.getOrders(store, limit);
	}
}