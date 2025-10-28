import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { OrdersController } from './orders.controller';
import { OrderService } from './order.service';
import { ShopModule } from '../shop/shop.module';

@Module({
    imports: [HttpModule, ShopModule],
    controllers: [ OrdersController ],
    providers: [ OrderService ],
    exports: [ OrderService ], // Export so other modules can use it
})

export class OrdersModule {}