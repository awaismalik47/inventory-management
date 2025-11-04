import { Module } from "@nestjs/common";
import { UserService } from "./user.service";
import { UserController } from "./user.controller";
import { MongooseModule } from "@nestjs/mongoose";
import { Users, UsersSchema } from "src/schema/user.schema";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";

@Module({
    imports: [ 
        MongooseModule.forFeature([{ name: Users.name, schema: UsersSchema }]),
    ],
    controllers: [UserController],
    providers: [UserService, JwtAuthGuard],
    exports: [UserService],
})
export class UserModule {}