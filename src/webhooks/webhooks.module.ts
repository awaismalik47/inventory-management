import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';
import { Shop, ShopSchema } from '../schema/shop.schema';
import { WebhooksService } from './webhooks.service';
import { WebhooksController } from './webhooks.controller';
import { ShopModule } from '../shop/shop.module';
import { ProductModule } from '../products/product.module';
import { OrdersModule } from '../orders/orders.module';
import { EventsModule } from '../events/events.module';

@Module({
	imports: [
		MongooseModule.forFeature([{ name: Shop.name, schema: ShopSchema }]),
		HttpModule,
		ShopModule,
		ProductModule,
		OrdersModule,
		EventsModule,
	],
	providers: [WebhooksService],
	controllers: [WebhooksController],
	exports: [WebhooksService],
})
export class WebhooksModule {}