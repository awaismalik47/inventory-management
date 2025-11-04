import { Injectable, NotFoundException } from "@nestjs/common";
import { Model } from "mongoose";
import { InjectModel } from "@nestjs/mongoose";

// Schemas
import { Users } from "src/schema/user.schema";


// Services
import { ShopService } from "src/shop/shop.service";

@Injectable()
export class UserService {

	constructor( @InjectModel(Users.name) private userModel: Model<Users>, readonly shopService: ShopService ) {}


	// Find user by id
	async findById( userId: string ) {
		const user = await this.userModel.findById(userId).select('-password');
		if ( !user ) {
			throw new NotFoundException('User not found');
		}

		return {
			id: user._id,
			email: user.email,
			name: user.name,
			shop: await this.findShopByUserId( userId ),
		};
	}


	// Find shop by user id
	async findShopByUserId( userId: string ) {
		const shop = await this.shopService.findByInstalledByUserId( userId );
		return shop ? shop.shop : null;
	}
}