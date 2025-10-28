import { Model } from "mongoose";
import { InjectModel } from "@nestjs/mongoose";
import { NotFoundException, UnauthorizedException } from "@nestjs/common";
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';

// Schemas
import { User } from "src/schema/user.schema";

// Services
import { ShopService } from "src/shop/shop.service";

// Dto
import { SigninDto } from "./dto";


export class LoginService {
	constructor( @InjectModel(User.name) private userModel: Model<User>, private readonly shopService: ShopService ) {}

	async login( dto: SigninDto ) {

		const user = await this.userModel.findOne({ email: dto?.email });
		
		if ( !user ) {
			throw new NotFoundException('User not found');
		}

		const isPasswordValid = await bcrypt.compare( dto?.password, user?.password );

		if ( !isPasswordValid ) {
			throw new UnauthorizedException('Invalid password');
		}

		const token = jwt.sign( { userId: user?._id }, process.env.JWT_SECRET!, { expiresIn: '24h' } );
		const shop  = await this.shopService.findByInstalledByUserId( user?._id as string );

		return {
			message     : 'Login successful',
			userId      : user?._id,
			token       : token,
			appStatus   : shop ? true : false,
			shop        : shop ? shop?.shop : null,
		};
	}

}