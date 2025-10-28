import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { RestockPredictionController } from './restock-prediction.controller';
import { ShopModule } from '../shop/shop.module';
import { RestockPredictionService } from './restock-prediction.service';
import { ProductModule } from '../products/product.module';
import { OrdersModule } from '../orders/orders.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Module({
    imports: [
        HttpModule, 
        ShopModule, 
        ProductModule, 
        OrdersModule,
    ],
    controllers: [ RestockPredictionController ],
    providers: [ RestockPredictionService, JwtAuthGuard ],
    exports: [ RestockPredictionService ]
})  

export class RestockPredictionModule {}