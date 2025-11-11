import { Controller, Get, Query } from '@nestjs/common';

// Services
import { OrderService } from './order.service';


@Controller('orders')
export class OrdersController {


    constructor( private readonly orderService: OrderService ) {}


    @Get()
    async getAllOrders(@Query() query: { store?: string; days?: string }): Promise<any> {
        console.log(`[getAllOrders] Starting to fetch orders from last ${query.days ?? '30'} days for store: ${query.store ?? ''}`);
        return await this.orderService.getAllOrders(query.store ?? '', parseInt(query.days ?? '30'));
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