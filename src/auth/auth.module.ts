import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AuthController } from './auth.controller';
import { ShopModule } from '../shop/shop.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { ProductModule } from '../products/product.module';

@Module({
    imports: [HttpModule, ShopModule, WebhooksModule, ProductModule],
    controllers: [ AuthController ],
})

export class AuthModule {}