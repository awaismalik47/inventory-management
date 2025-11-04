import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ShopModule } from './shop/shop.module';
import { MongooseModule } from '@nestjs/mongoose';
import configuration from './core/configuration';
import { HttpModule } from '@nestjs/axios';
import { ProductModule } from './products/product.module';
import { OrdersModule } from './orders/orders.module';
import { SignupModule } from './signup/signup.module';
import { LoginModule } from './signin/signin.module';
import { AppRegistrationModule } from './app-registration/app-register.module';
import { RestockPredictionModule } from './restock-prediction/restock-prediction.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { UserModule } from './user/user.module';
import { JwtModule } from '@nestjs/jwt';
import { EventsModule } from './events/events.module';
import { ExportModule } from './export/export.module';


@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
			load: [configuration],
		}),

		HttpModule.registerAsync({
			imports: [ConfigModule],
			useFactory: async() => {
				return {
					timeout: 120000,	
				};
			},
		}),

		JwtModule.register({
			global: true,
			secret: process.env.JWT_SECRET,
			signOptions: { expiresIn: '1d' },
		}),

		MongooseModule.forRoot( process.env.DATABASE_URL! ),
		AuthModule,
		ShopModule,
		ProductModule,
		OrdersModule,
		SignupModule,
		LoginModule,
		AppRegistrationModule,
		RestockPredictionModule,
		WebhooksModule,
		UserModule,
		EventsModule,
		ExportModule,
  	],

	controllers: [AppController],
	providers: [AppService],
})
export class AppModule {}
