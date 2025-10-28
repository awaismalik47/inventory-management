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
  
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
	@WebSocketServer()
	server: Server;


	@SubscribeMessage('message')
	handleMessage( client: Socket, payload: any ): void {
		console.log('Received message from client:', payload);
		client.emit('message', 'Hello from server');
	}

	handleConnection( client: Socket ): void {

		const shop = client.handshake.query['shop'] as string;

		if ( shop ) {
			client.join(shop);
			console.log(`🟢 Client connected for shop: ${shop}`);
		} else {
			console.log('⚠️ Client connected without shop query');
		}
	}

	handleDisconnect( client: Socket ): void {
		const shop = client.handshake.query['shop'] as string;
		console.log(`🔴 Client disconnected for shop: ${shop}`);
	}

	emitToShop( shop: string, eventName: string, data: any ): void {
		console.log(`📢 Emitting ${eventName} to shop: ${shop}`);
		this.server.to( shop ).emit( eventName, data );
	}
}
  