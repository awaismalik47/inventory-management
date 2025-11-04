import {
	WebSocketGateway,
	WebSocketServer,
	OnGatewayConnection,
	OnGatewayDisconnect,
	SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
  
@WebSocketGateway({
	cors: { origin: '*' },
})
  
export class EventsGateway {


	
	// handleConnection( client: Socket ): void {

	// 	const shop = client.handshake.query['shop'] as string;
	// 	if ( shop ) {
	// 		client.join(shop);
	// 	} else {
	// 		client.disconnect();
	// 	}
	// }


	// handleDisconnect( client: Socket ): void {
	// 	const shop = client.handshake.query['shop'] as string;
	// }


	// emitToShop( shop: string, eventName: string, data: any ): void {
	// 	this.server.to( shop ).emit( eventName, data );
	// }
}
  