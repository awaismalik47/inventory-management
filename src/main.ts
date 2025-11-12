/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'express';


async function bootstrap() {
	const app = await NestFactory.create(AppModule);
	const configService = app.get(ConfigService);
	
	// Get CORS configuration
	const corsAllowedUrls = configService.get('corsAllowedUrls');
	
	// Enable CORS with proper configuration
	app.enableCors({
		origin: corsAllowedUrls,
		methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
		allowedHeaders: [
			'Content-Type', 
			'Authorization', 
			'X-Shopify-Access-Token', 
			'ngrok-skip-browser-warning',
			'Accept',
			'Origin',
			'X-Requested-With'
		],
		exposedHeaders: ['Content-Type', 'Authorization'],
		credentials: true,
		preflightContinue: false,
		optionsSuccessStatus: 204,
	});

	app.use(json({ limit: '1mb' }));
	app.use(urlencoded({ extended: true, limit: '1mb' }));
	
	app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

	const port = process.env.PORT || 3000;
	await app.listen(port);
	
	console.log(`🚀 Application is running on: http://localhost:${port}`);
	console.log(`🌐 CORS enabled for: ${corsAllowedUrls === true ? 'all origins' : Array.isArray(corsAllowedUrls) ? corsAllowedUrls.join(', ') : corsAllowedUrls}`);
}
bootstrap().catch( ( error) => {
	console.error('Application failed to start:', error);
	process.exit(1);
});
