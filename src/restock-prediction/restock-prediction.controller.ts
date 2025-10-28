import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { RestockPredictionService } from "./restock-prediction.service";
import type { RestockPredictionQueryModel, RestockPredictionModel } from "src/models/restock-prediction.model";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";

@Controller('restock-prediction')
@UseGuards(JwtAuthGuard)
export class RestockPredictionController {
    constructor( 
        private readonly restockPredictionService: RestockPredictionService
    ) {}

    @Get()
    async getRestockPredictions(@Query() query: RestockPredictionQueryModel): Promise<RestockPredictionModel[]> {
        return await this.restockPredictionService.generateRestockPredictions(
            query.store ?? '', 
            query.limit ?? '50',
            query.rangeDays1 ?? '7', // Changed default to 7 days
            query.rangeDays2 ?? '30',
            query.urgencyFilter
        );
    }
}