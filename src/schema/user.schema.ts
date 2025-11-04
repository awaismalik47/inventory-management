import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';


@Schema({ timestamps: true })
export class Users extends Document {
	@Prop({ required: true, unique: true })
	email: string;

	@Prop({ required: true })
	name: string;

	@Prop({ required: true })
	password: string;

	// @Prop({ default: Date.now })
	// installedApps: Array<string>;
}

export const UsersSchema = SchemaFactory.createForClass(Users);
