import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SignupService } from './signup.service';
import { Users, UsersSchema } from 'src/schema/user.schema';
import { SignupController } from './signup.controller';
import { UserModule } from 'src/user/user.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Users.name, schema: UsersSchema }]),
    UserModule
  ],
  controllers: [SignupController],
  providers: [SignupService],
})
export class SignupModule {}
