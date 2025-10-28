import { Injectable } from "@nestjs/common";
import { ProductService } from "src/products/product.service";
import { OrderService } from "src/orders/order.service";
import type { RestockPredictionModel } from "src/models/restock-prediction.model";
import type { IProductModel, IVariantModel } from "src/models/product.model";
import type { orderModel } from "src/models/order.model";

@Injectable()
export class RestockPredictionService {
	constructor( 
		private readonly productService: ProductService,
		private readonly orderService: OrderService
	) {}

	async generateRestockPredictions(
		store     : string, 
		limit     : string = '50', 
		rangeDays1: string = '7',
		rangeDays2: string = '30',
		futureDays: string = '15',
	): Promise<RestockPredictionModel[]> {
		try {

			// Get data from services
			const { products, orders } = await this.fetchData( store, limit );
			if (!products || !orders) return [];

			// Parse parameters
			const shortRangeDays = parseInt(rangeDays1);
			const longRangeDays  = parseInt(rangeDays2);
			const predictionDays = parseInt(futureDays);

			// Calculate sales for both time ranges
			const shortRangeSales = await this.calculateSalesForPeriod(products, orders, shortRangeDays);
			const longRangeSales = await this.calculateSalesForPeriod(products, orders, longRangeDays);

			// Generate restock predictions
			return this.generatePredictions(products, shortRangeSales, longRangeSales, predictionDays);
		} catch (error) {
			console.error('Error generating restock predictions:', error);
			return [];
		}
	}


	// Fetch data from services
	private async fetchData(store: string, limit: string) {
		const productsResponse = await this.productService.getProducts(store, limit);
		const ordersResponse   = await this.orderService.getOrders( store, limit );

		if ( productsResponse?.error || ordersResponse?.error ) {
			return { products: null, orders: null };
		}

		return {
			products: productsResponse as IProductModel[],
			orders: ordersResponse.orders as orderModel[]
		};
	}


	// Calculate sales data for a specific time period
	private async calculateSalesForPeriod(products: IProductModel[], orders: orderModel[], days: number) {
		const cutoffDate = this.getCutoffDate(days);
		const recentOrders = this.filterOrdersByDate(orders, cutoffDate);
		const salesByVariant = this.calculateVariantSales(recentOrders);
		
		return this.createSalesData(products, salesByVariant, days);
	}


	// Get cutoff date for filtering orders
	private getCutoffDate(days: number): Date {
		const cutoffDate = new Date();
		cutoffDate.setDate(cutoffDate.getDate() - days);
		return cutoffDate;
	}


	// Filter orders by date
	private filterOrdersByDate(orders: orderModel[], cutoffDate: Date): orderModel[] {
		return orders.filter(order => new Date(order.createdAt) >= cutoffDate);
	}


	// Calculate total sales for each variant
	private calculateVariantSales(orders: orderModel[]): Map<number, number> {
		const salesMap = new Map<number, number>();
		
		orders.forEach(order => {
			const currentSales = salesMap.get(order.variantId) || 0;
			salesMap.set(order.variantId, currentSales + order.quantity);
		});
		
		return salesMap;
	}


	// Create sales data structure for all variants
	private createSalesData(products: IProductModel[], salesByVariant: Map<number, number>, days: number): any[] {
		const salesData: any[] = [];
		
		products.forEach(product => {
			product.variants.forEach(variant => {
				const totalSales = salesByVariant.get(variant.id) || 0;
				const perDaySales = totalSales / days;
				
				salesData.push({
					variantId: variant.id,
					productId: product.id,
					productName: product.title,
					variantName: variant.title,
					totalSales,
					perDaySales
				});
			});
		});
		
		return salesData;
	}


	// Generate final predictions with restock recommendations
	private generatePredictions(products: IProductModel[], shortRangeSales: any[], longRangeSales: any[], predictionDays: number): any[] {
		const predictions: any[] = [];
		
		products.forEach(product => {
			product.variants.forEach(variant => {
				const shortRangeData = this.findSalesData(shortRangeSales, variant.id);
				const longRangeData = this.findSalesData(longRangeSales, variant.id);
				
				const prediction = this.createPrediction(
					product, 
					variant, 
					shortRangeData, 
					longRangeData, 
					predictionDays
				);
				
				predictions.push(prediction);
			});
		});
		
		return predictions;
	}


	// Find sales data for a specific variant
	private findSalesData(salesData: any[], variantId: number) {
		return salesData.find(data => data.variantId === variantId) || {
			totalSales: 0,
			perDaySales: 0
		};
	}


	// Create a complete prediction for a variant
	private createPrediction(product: IProductModel, variant: IVariantModel, shortRange: any, longRange: any, predictionDays: number): RestockPredictionModel {
		const availableStock = variant.available || 0;
		const incomingStock = variant.incoming || 0;
		const totalInventory = availableStock + incomingStock;
		
		// Calculate average sales velocity
		const averagePerDaySales = (shortRange.perDaySales + longRange.perDaySales) / 2;
		const expectedSales = averagePerDaySales * predictionDays;
		
		// Calculate recommended average stock (only if current inventory is insufficient)
		const recommendedAverageStock = Math.max(0, expectedSales - totalInventory);
		
		return {
			// Basic info
			productImage: variant.imageSrc ? variant.imageSrc : product.imageUrl,
			productId: product.id,
			productName: product.title,
			variantId: variant.id,
			variantName: variant.title,
			
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
		};
	}


	// Calculate how much to restock based on sales velocity and current inventory
	private calculateRestockQuantity(perDaySales: number, predictionDays: number, availableStock: number, incomingStock: number): number {
		const expectedSales = perDaySales * predictionDays;
		const totalInventory = availableStock + incomingStock;
		const restockNeeded = Math.max(0, expectedSales - totalInventory);
		
		return Math.ceil(restockNeeded); // Round up to avoid stockouts
	}


	async getProducts(store: string, limit: string = '50'): Promise<any> {
		return await this.productService.getProducts(store, limit);
	}


	async getOrders(store: string, limit: string = '50'): Promise<any> {
		return await this.orderService.getOrders(store, limit);
	}
}