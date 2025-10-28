import { Controller, Post } from '@nestjs/common';
import { ShopService } from './shop.service';

@Controller('shop')
export class ShopController {
  constructor(private readonly shopService: ShopService) {}

  @Post('dummy')
  async createDummy() {
    const result = await this.shopService.upsertShop({
      shop: 'dummy-store.myshopify.com',
      accessToken: 'shpat_dummy_access_token',
      scopes: 'read_products,write_products',
    });
    return { message: 'Dummy shop saved!', result };
  }
}
