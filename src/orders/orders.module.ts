import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MongooseModule } from '@nestjs/mongoose';
import { OrdersController } from './orders.controller';
import { OrderService } from './order.service';
import { ShopModule } from '../shop/shop.module';
import { OrderHistory, OrderHistorySchema } from '../schema/order-history.schema';

@Module({
	imports: [
		HttpModule,
		ShopModule,
		MongooseModule.forFeature([
			{ name: OrderHistory.name, schema: OrderHistorySchema }
		]),
	],
	controllers: [ OrdersController ],
	providers: [ OrderService ],
	exports: [ OrderService ], // Export so other modules can use it
})

export class OrdersModule {}