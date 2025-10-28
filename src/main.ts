/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';


async function bootstrap() {
	const app = await NestFactory.create(AppModule);
	const configService = app.get(ConfigService);
	
	// Enable CORS
	app.enableCors({
		origin: configService.get('corsAllowedUrls') === '*' ? true : configService.get('corsAllowedUrls'),
		methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
		allowedHeaders: ['Content-Type', 'Authorization', 'X-Shopify-Access-Token', 'ngrok-skip-browser-warning'],
		credentials: true,
	});
	
	app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

	const port = process.env.PORT || 3000;
	await app.listen(port);
}
bootstrap().catch( ( error) => {
	console.error('Application failed to start:', error);
	process.exit(1);
});
