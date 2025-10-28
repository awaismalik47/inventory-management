import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Shop, ShopSchema } from '../schema/shop.schema';
import { ShopService } from './shop.service';
import { ShopController } from './shop.controller';

@Global()
@Module({
    imports: [MongooseModule.forFeature([{ name: Shop.name, schema: ShopSchema }])],
    providers: [ShopService],
    controllers: [ShopController],
    exports: [ShopService],
})
export class ShopModule {}