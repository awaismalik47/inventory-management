import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LoginService } from './signin.service';
import { Users, UsersSchema } from '../schema/user.schema';
import { LoginController } from './signin.controller';


@Module({
imports: [
	MongooseModule.forFeature([{ name: Users.name, schema: UsersSchema }])
],
	controllers: [ LoginController ],
	providers  : [ LoginService ],
})
export class LoginModule {}
