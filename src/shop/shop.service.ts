import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';

// Model
import { Model } from 'mongoose';

// Schemas
import { Shop } from '../schema/shop.schema';


@Injectable()
export class ShopService {

  constructor( @InjectModel(Shop.name) private shopModel: Model<Shop> ) {}
	
	async upsertShop( shopData: { shop: string; accessToken: string; scopes?: string; installedByUserId?: string; shopifyDomain?: string } ) {
		return this.shopModel.findOneAndUpdate(
			{ shop: shopData.shop },
			{ $set: shopData },
			{ upsert: true, new: true }
		);
	}


	async findByShop( shop: string ) {
		return await this.shopModel.findOne({ shop });
	}


	async findByShopifyDomain( shopifyDomain: string ) {
		return await this.shopModel.findOne({ shopifyDomain });
	}


	async deleteShop( shop: string) {
		return await this.shopModel.findOneAndDelete({ shop });
	}


	async findByInstalledByUserId( userId: string ) {
		return await this.shopModel.findOne({ installedByUserId: userId });
	}


	async CheckShopExistsInShopify( shop: string, accessToken: string ) {
		try {
			const response = await fetch(`https://${shop}/admin/api/2025-01/shop.json`, {
			headers: {
				"X-Shopify-Access-Token": accessToken,
				"Content-Type": "application/json",
			},
		});	

			if ( response.status === 200 ) {
				const data = await response.json();
				return {
					valid: true,
					shop: data.shop,
				};
			}

			if ( response.status === 401 ) {
				return {
					valid: false,
					error: "Unauthorized or token expired",
				};
			}

			if ( response.status === 404 ) {
				return {
					valid: false,
					error: "Shop not found",
				};
			}

			return {
				valid: false,
				error: `Unexpected status: ${response.status}`,
			};
		} catch ( error: any ) {
			return {
				valid: false,
				error: error.message
			};
		}
	}
}
