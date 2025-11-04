import { UrgencyLevelEnum } from "src/core/enums";

export interface RestockPredictionModel {
    productImage: string;
    productId: number;
    productName: string;
    variantId: number;
    variantName: string;
    sku: string;
    shortRangeSales: number;
    longRangeSales: number;
    perDaySoldShortRange: number;
    perDaySoldLongRange: number;
    availableStock: number;
    incomingStock: number;
    totalInventory: number;
    recommendedAverageStock: number;
    recommendedRestockShortRange: number;
    recommendedRestockLongRange: number;
    urgencyLevel: UrgencyLevelEnum;
}


export interface RestockPredictionQueryModel {
    store?        : string;
    limit?        : string;
    rangeDays1?   : string; 
    rangeDays2?   : string;
    futureDays?   : string;
    urgency?      : UrgencyLevelEnum | null;
}
