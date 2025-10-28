import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SignupController } from './signup.controller';
import { SignupService } from './signup.service';
import { User, UserSchema } from '../schema/user.schema';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    UserModule
  ],
  controllers: [SignupController],
  providers: [SignupService],
})
export class SignupModule {}
