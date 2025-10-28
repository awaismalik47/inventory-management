import { Injectable } from "@nestjs/common";
import { Model } from "mongoose";
import { User } from "src/schema/user.schema";
import { InjectModel } from "@nestjs/mongoose";

@Injectable()
export class UserService {

    constructor( @InjectModel(User.name) private userModel: Model<User> ) {}

    async findById(userId: string) {
        return this.userModel.findById(userId).select('-password');
    }


    async findByEmail(email: string) {
        return this.userModel.findOne({ email });
    }

}