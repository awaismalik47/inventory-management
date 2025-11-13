import { Controller, Get, Query } from '@nestjs/common';

// Services
import { OrderService } from './order.service';


@Controller('orders')
export class OrdersController {


    constructor( private readonly orderService: OrderService ) {}


    @Get()
    async getAllOrders( @Query() query: { store?: string; days?: string } ): Promise<any> {
        console.log(`[getAllOrders] Starting to fetch orders from last ${query.days ?? '30'} days for store: ${query.store ?? ''}`);
        const now = new Date();

        // ---- START DATE ----
        // Clone current date
        const startDate = new Date(now);
        // Move back (days - 1)
        startDate.setDate( startDate.getDate() - (parseInt(query.days ?? '30') - 1) );
        // Reset time to start of the day (00:00:00)
        startDate.setHours(0, 0, 0, 0);
        
        // ---- END DATE ----
        // Clone again to avoid mutation
        const endDate = new Date(now);
        // Reset time to end of the day (23:59:59)
        endDate.setHours(23, 59, 59, 999);
        
        // ---- Convert to Shopify UTC ISO format ----
        const startDateUTC = startDate.toISOString();
        const endDateUTC = endDate.toISOString();

        return await this.orderService.getAllOrdersByRange( query.store ?? '', startDateUTC, endDateUTC, true );
    }


    @Get('range')
    async getOrdersByRange( @Query() query: { store?: string; startDate?: string; endDate?: string } ): Promise<any> {
        return await this.orderService.getAllOrdersByRange(
            query.store ?? '',
            query.startDate ?? '',
            query.endDate ?? ''
        );
    }


    @Get('local')
    async getOrderFromLocalDb( @Query() query: { store?: string; orderId?: string } ): Promise<any> {
        return await this.orderService.getOrderFromLocalDb( query.store ?? '', query.orderId ?? '' );
    }

}