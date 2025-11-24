import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MongooseModule } from '@nestjs/mongoose';
import { ProductController } from './product.controller';
import { ShopModule } from '../shop/shop.module';
import { ProductService } from './product.service';
import { TrackIncoming, TrackIncomingSchema } from '../schema/incoming-history.schema';

@Module({
    imports: [
        HttpModule, 
        ShopModule,
        MongooseModule.forFeature([{ name: TrackIncoming.name, schema: TrackIncomingSchema }])
    ],
    controllers: [ ProductController ],
    providers: [ ProductService ],
    exports: [ ProductService ],
})  

export class ProductModule {}