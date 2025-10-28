import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LoginService } from './signin.service';
import { User, UserSchema } from '../schema/user.schema';
import { LoginController } from './signin.controller';


@Module({
imports: [
	MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])
],
	controllers: [ LoginController ],
	providers  : [ LoginService ],
})
export class LoginModule {}
