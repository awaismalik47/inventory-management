import { Module } from '@nestjs/common';
import { RestockPredictionModule } from '../restock-prediction/restock-prediction.module';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';

@Module({
    imports: [ RestockPredictionModule ],
    controllers: [ ExportController ],
    providers: [ ExportService ],
})

export class ExportModule {}