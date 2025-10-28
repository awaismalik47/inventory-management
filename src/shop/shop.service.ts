import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';

// Model
import { Model } from 'mongoose';

// Schemas
import { Shop } from '../schema/shop.schema';


@Injectable()
export class ShopService {

  constructor( @InjectModel(Shop.name) private shopModel: Model<Shop> ) {}
	
	async upsertShop( shopData: { shop: string; accessToken: string; scopes?: string; installedByUserId?: string } ) {
		return this.shopModel.findOneAndUpdate(
			{ shop: shopData.shop },
			{ $set: shopData },
			{ upsert: true, new: true }
		);
	}

	async findByShop( shop: string ) {
		return await this.shopModel.findOne({ shop });
	}

	async deleteShop( shop: string) {
		return await this.shopModel.findOneAndDelete({ shop });
	}

	async findByInstalledByUserId( userId: string ) {
		return await this.shopModel.findOne({ installedByUserId: userId });
	}
  
}
