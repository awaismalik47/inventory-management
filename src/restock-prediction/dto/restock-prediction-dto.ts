import { Transform } from "class-transformer";
import { IsEnum, IsNotEmpty, IsOptional, IsString } from "class-validator";
import { UrgencyLevelEnum } from "src/core/enums";

export class RestockPredictionQueryDto {
	/**
	 * Store domain (required)
	 * Example: your-store.myshopify.com
	 */
	@IsNotEmpty()
	@IsString()
	store: string;

	/**
	 * Filter predictions by urgency level (optional)
	 */
	@IsOptional()
	@Transform(({ value }) => {
		// Convert "null" or "undefined" to actual null
		if ( value === 'null' || value === 'undefined' || value === '' ) return null;
		return value;
	})

	@IsOptional()
	@IsString()
	futureDays?: string;

	// Note: limit and page removed - endpoint now fetches ALL products and orders automatically
}