import { Controller, Get, Query } from '@nestjs/common';
import { ShopService } from 'src/shop/shop.service';
import { ProductService } from './product.service';

@Controller('products')
export class ProductController {
    
    constructor( private readonly shopService: ShopService, private readonly productService: ProductService) {}


    @Get()
    async getAllProducts(@Query() query: { store?: string; limit?: string }): Promise<any> {
        return this.productService.getProducts( query.store ?? '', query.limit || '50' );
    }
}