import { Controller, Get, Query, UseGuards, ValidationPipe } from "@nestjs/common";

// Services
import { RestockPredictionService } from "./restock-prediction.service";

// Models
import type { RestockPredictionModel } from "src/models/restock-prediction.model";

// Guards
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";

// DTOs
import { RestockPredictionQueryDto } from "./dto/index";


@Controller('restock-prediction')
@UseGuards(JwtAuthGuard)
export class RestockPredictionController {

	constructor( private readonly restockPredictionService: RestockPredictionService ) {}


	@Get()
	async getRestockPredictions ( @Query(new ValidationPipe({ transform: true })) dto: RestockPredictionQueryDto ): Promise<RestockPredictionModel[]> {
		const { store, futureDays, status } = dto;

		return await this.restockPredictionService.generateRestockPredictions(
			store,
			futureDays,
			status
		);
	}
}