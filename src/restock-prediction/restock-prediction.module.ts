import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MongooseModule } from '@nestjs/mongoose';
import { RestockPredictionController } from './restock-prediction.controller';
import { ShopModule } from '../shop/shop.module';
import { RestockPredictionService } from './restock-prediction.service';
import { ProductModule } from '../products/product.module';
import { OrdersModule } from '../orders/orders.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TrackIncoming, TrackIncomingSchema } from '../schema/incoming-history.schema';

@Module({
    imports: [
        HttpModule, 
        ShopModule, 
        ProductModule, 
        OrdersModule,
        MongooseModule.forFeature([{ name: TrackIncoming.name, schema: TrackIncomingSchema }])
    ],
    controllers: [ RestockPredictionController ],
    providers: [ RestockPredictionService, JwtAuthGuard ],
    exports: [ RestockPredictionService ]
})  

export class RestockPredictionModule {}