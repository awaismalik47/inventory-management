import { Injectable } from "@nestjs/common";
import { Parser } from "json2csv";

// DTOs
import { RestockPredictionQueryDto } from "src/restock-prediction/dto/restock-prediction-dto";

// Services
import { RestockPredictionService } from "src/restock-prediction/restock-prediction.service";

// Models
import type { RestockPredictionModel } from "src/models/restock-prediction.model";

@Injectable()
export class ExportService {
	constructor(
		private readonly restockPredictionService: RestockPredictionService
	) {}

	async exportToCsv( body: RestockPredictionQueryDto ): Promise<string> {
        const { store, futureDays, status } = body;
        const predictions = await this.restockPredictionService.generateRestockPredictions(
            store,
            futureDays,
            status ?? 'active'
        );
        return new Parser().parse( predictions );
	}

	async exportSpecificProducts( body: RestockPredictionModel[] ): Promise<string> {
		return new Parser().parse( body );
	}

}