import { Transform } from "class-transformer";
import { IsEnum, IsNotEmpty, IsOptional, IsString } from "class-validator";
import { UrgencyLevelEnum } from "src/core/enums";

export class RestockPredictionQueryDto {
	@IsNotEmpty()
	@IsString()
	store: string;


	@IsOptional()
	@Transform(({ value }) => {
		// Convert "null" or "undefined" to actual null
		if ( value === 'null' || value === 'undefined' || value === '' ) return null;
		return value;
	})

	@IsOptional()
	@IsString()
	futureDays?: string;

	@IsOptional()
	@IsString()
	status?: string;

	// Note: limit and page removed - endpoint now fetches ALL products and orders automatically
}