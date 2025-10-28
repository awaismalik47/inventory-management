import { Module } from '@nestjs/common';
import { AppStatusController } from './app-status.controller';
import { AppStatusService } from './app-status.service';
import { ShopService } from 'src/shop/shop.service';
import { Shop, ShopSchema } from 'src/schema/shop.schema';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: Shop.name, schema: ShopSchema }]),
    ],
    controllers: [ AppStatusController ],
    providers: [ AppStatusService, ShopService, JwtAuthGuard ],
})

export class AppStatusModule {}