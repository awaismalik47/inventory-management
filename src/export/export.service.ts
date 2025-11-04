import { Injectable } from "@nestjs/common";
import { Parser } from "json2csv";

// DTOs
import { RestockPredictionQueryDto } from "src/restock-prediction/dto/restock-prediction-dto";

// Services
import { RestockPredictionService } from "src/restock-prediction/restock-prediction.service";


@Injectable()
export class ExportService {
	constructor(
		private readonly restockPredictionService: RestockPredictionService
	) {}

	async exportToCsv( body: RestockPredictionQueryDto ): Promise<string> {
        const { store, rangeDays1, rangeDays2, futureDays, urgency } = body;
        const predictions = await this.restockPredictionService.generateRestockPredictions(
            store,
            rangeDays1,
            rangeDays2,
            futureDays,
            urgency,
        );
        return new Parser().parse( predictions );
	}

}