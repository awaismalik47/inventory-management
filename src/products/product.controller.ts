import { Controller, Get, Query } from '@nestjs/common';

// Services
import { ProductService } from './product.service';

@Controller('products')
export class ProductController {
    
    constructor( private readonly productService: ProductService ) {}


    @Get()
    async getAllProducts( @Query() query: { store?: string, status?: string } ): Promise<any> {
        return this.productService.getAllProducts( query.store ?? '', query.status ?? 'active', true );
    }


    @Get('total')
    async getTotalProducts( @Query() query: { store?: string, status?: string } ): Promise<any> {
        return this.productService.getTotalProducts( query.store ?? '', query.status ?? 'active' );
    }
    

    @Get('inventory')
    async getInventory( @Query() query: { store?: string, productId?: string } ): Promise<any> {
        return this.productService.getInventoryLevelByProductId( query.store ?? '', query.productId ?? '' );
    }
}