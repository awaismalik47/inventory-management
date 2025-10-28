import { Controller, Get, Query } from '@nestjs/common';
import { OrderService } from './order.service';

@Controller('orders')
export class OrdersController {
    constructor( private readonly orderService: OrderService ) {}

    @Get()
    async getOrders(@Query() query: { store?: string; limit?: string }): Promise<any> {
        return await this.orderService.getOrders(query.store ?? '', query.limit);
    }
}