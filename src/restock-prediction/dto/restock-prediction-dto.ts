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
	@IsEnum(UrgencyLevelEnum)
	urgency?: UrgencyLevelEnum | null;

	/**
	 * Short range days for sales calculation (optional, default: 7)
	 * Number of days to look back for short-term sales trend
	 */
	@IsOptional()
	@IsString()
	rangeDays1?: string;

	/**
	 * Long range days for sales calculation (optional, default: 30)
	 * Number of days to look back for long-term sales trend
	 */
	@IsOptional()
	@IsString()
	rangeDays2?: string;

	/**
	 * Future prediction days (optional, default: 15)
	 * Number of days ahead to predict restock needs
	 */
	@IsOptional()
	@IsString()
	futureDays?: string;

	// Note: limit and page removed - endpoint now fetches ALL products and orders automatically
}