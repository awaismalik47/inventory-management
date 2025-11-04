import { Injectable, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Users } from 'src/schema/user.schema';
import * as bcrypt from 'bcrypt';
import type { SignupDataModel } from 'src/models/user.model';
import { SignupDto } from './dto';

@Injectable()
export class SignupService {

 	constructor( @InjectModel(Users.name) private userModel: Model<Users> ) {}


	async addUser(dto: SignupDto) {
		
		try {
			// Check if user already exists
			const existingUser = await this.userModel.findOne({ email: dto?.email });
			if ( existingUser ) {
				throw new ConflictException('User with this email already exists');
			}

			// Hash the password
			const saltRounds = 10;
			const hashedPassword = await bcrypt.hash( dto.password, saltRounds );

			// Create new user (MongoDB will auto-generate _id)
			const newUser = new this.userModel({
				email   : dto.email,
				password: hashedPassword,
				name    : dto.name,
			});

			await newUser.save();

			return {
				message: 'User created successfully',
			};
		} catch ( error ) {
			if ( error instanceof ConflictException ) {
				throw error;
			}
			throw new BadRequestException('Failed to create user');
		}
	}
}