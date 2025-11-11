import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class OrderHistory extends Document {
	@Prop({ required: true, index: true, type: String })
	shop: string;

	@Prop({ required: true, index: true, type: Number })
	orderId: number | null;

	@Prop({ required: true, type: String })
	orderNumber: string;

	@Prop({ required: true, index: true, type: Date })
	orderCreatedAt: Date;

	@Prop({ type: String })
	financialStatus: string;

	@Prop({ type: String })
	fulfillmentStatus: string;

	@Prop({ type: Number })
	productId: number | null;

	@Prop({ type: String })
	productName: string;

	@Prop({ type: Boolean })
	productExists: boolean;

	@Prop({ type: Number })
	variantId: number | null;

	@Prop({ required: true, type: Number })
	quantity: number;

	@Prop({ type: String })
	variantTitle: string;

	@Prop({ required: true, index: true, type: String })
	dedupeKey: string;
}

export type OrderHistoryDocument = OrderHistory & Document;

export const OrderHistorySchema = SchemaFactory.createForClass(OrderHistory);

OrderHistorySchema.index(
	{ shop: 1, dedupeKey: 1 },
	{ unique: true, name: 'order_history_unique_per_shop_line_item' }
);


