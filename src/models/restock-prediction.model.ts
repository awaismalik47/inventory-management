import { UrgencyLevelEnum } from "src/core/enums";

export interface RestockPredictionModel {
	status: string;
	productImage: string;
	productId: number;
	productName: string;
	variantId: number;
	variantName: string;
	sku: string;
	sevenDaysRangeSales: number;
	fourteenDaysRangeSales: number;
	thirtyDaysRangeSales: number;
	perDaySoldSevenDaysRange: number;
	perDaySoldFourteenDaysRange: number;
	perDaySoldThirtyDaysRange: number;
	availableStock: number;
	incomingStock: number;
	totalInventory: number;
	recommendedAverageStock: number;
	recommendedRestockSevenDaysRange: number;
	recommendedRestockFourteenDaysRange: number;
	recommendedRestockThirtyDaysRange: number;
	urgencyLevel: UrgencyLevelEnum;
}


export interface RestockPredictionQueryModel {
	store?        : string;
	futureDays?   : string;
	status?       : string;
}
