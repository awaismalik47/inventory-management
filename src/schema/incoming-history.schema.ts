import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export class IncomingChange {
	@Prop({ required: true, type: Date })
	date: Date;

	@Prop({ required: true })
	quantity: number;

	@Prop({ required: true, default: 0 })
	totalOrderQuantity: number;
}

@Schema({ timestamps: true })
export class TrackIncoming extends Document {
	@Prop({ required: true })
	shop: string;

	@Prop({ required: true })
	accessToken: string;

	@Prop()
	inventoryItemId?: number;

	@Prop({ required: true })
	variantId: number;

	@Prop({ required: true })
	productId: number;

	@Prop({ required: true })
	incoming: number;

	@Prop({ type: Date })
	incomingLastChangedAt?: Date;

	@Prop({ type: [IncomingChange], default: [] })
	incomingHistory?: IncomingChange[];
  
}

export type TrackIncomingDocument = TrackIncoming & Document;

export const TrackIncomingSchema = SchemaFactory.createForClass( TrackIncoming );

TrackIncomingSchema.index(
	{ shop: 1, variantId: 1 },
	{ unique: true, name: 'track_incoming_unique_variant_per_shop' }
);

  
