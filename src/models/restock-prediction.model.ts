export interface RestockPredictionModel {
    productImage: string;
    productId: number;
    productName: string;
    variantId: number;
    variantName: string;
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
}


export interface RestockPredictionQueryModel {
    store?        : string;
    limit?        : string;
    rangeDays1?   : string; 
    rangeDays2?   : string;
    urgencyFilter?:  'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}
