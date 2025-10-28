export interface orderModel {
    orderId: number;
    orderNumber: string;
    createdAt: string;
    financialStatus: string;
    fulfillmentStatus: string;
    productId: number;
    productName: string;
    productExists: boolean;
    variantId: number;
    quantity: number;
    variantTitle: string;
}