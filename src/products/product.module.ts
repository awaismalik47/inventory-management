import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ProductController } from './product.controller';
import { ShopModule } from '../shop/shop.module';
import { ProductService } from './product.service';

@Module({
    imports: [HttpModule, ShopModule],
    controllers: [ ProductController ],
    providers: [ ProductService ],
    exports: [ ProductService ],
})  

export class ProductModule {}