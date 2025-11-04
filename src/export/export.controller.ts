import { BadRequestException, Body, Controller, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';

// Services
import { ExportService } from './export.service';

// DTOs
import { RestockPredictionQueryDto } from 'src/restock-prediction/dto/restock-prediction-dto';

@Controller('export')
@UseGuards(JwtAuthGuard)
export class ExportController {

	constructor( private readonly exportService: ExportService ) {}


	@Post('csv')
	async exportToCsv( @Body() body: RestockPredictionQueryDto, @Res() res: Response ) {
		try {
			const csv = await this.exportService.exportToCsv( body );
			res.header('Content-Type', 'text/csv');
			res.attachment('restock-predictions.csv');
			return res.send(csv);
		} catch ( error ) {
			throw new BadRequestException(error);
		}
	}
}
	