import { Module } from '@nestjs/common';
import { RegisterShopController } from './app-register.controller';
import { AppRegistrationService } from './app-register.service';
import { ShopService } from 'src/shop/shop.service';
import { Shop, ShopSchema } from 'src/schema/shop.schema';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { ProductModule } from '../products/product.module';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: Shop.name, schema: ShopSchema }]),
        WebhooksModule,
        ProductModule,
    ],
    controllers: [ RegisterShopController ],
    providers: [ AppRegistrationService, ShopService, JwtAuthGuard ],
})

export class AppRegistrationModule {}