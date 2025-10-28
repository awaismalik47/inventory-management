import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class Shop extends Document {
  @Prop({ required: true, unique: true })
  shop: string;

  @Prop({ required: true })
  accessToken: string;

  @Prop()
  scopes: string;

  @Prop({ default: Date.now })
  installedAt: Date;

  @Prop()
  installedByUserId: string;
}

export const ShopSchema = SchemaFactory.createForClass( Shop );
