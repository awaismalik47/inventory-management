import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ShopService } from './shop.service';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';


@Controller('shop')
@UseGuards(JwtAuthGuard)
export class ShopController {
  constructor(private readonly shopService: ShopService) {}

    @Post()
    async getShopDetails( @Body() body: { shop: string } ) {
        const shop = await this.shopService.findByShop( body.shop );
        if ( !shop ) {
            return {
                error: 'Shop not found',
                status: 404
            };
        }
        const accessToken = shop.accessToken;
        const response = await this.shopService.CheckShopExistsInShopify( body.shop, accessToken );
        if ( response.valid ) {
            return { shopDomain: response.shop.myshopify_domain, status: 200 };
        }
        return {
            message: response.error,
            status: 400   
        };
    }
}
