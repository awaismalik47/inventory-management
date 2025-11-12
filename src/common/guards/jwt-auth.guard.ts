import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";

// Services
import { ShopService } from "src/shop/shop.service";


@Injectable()
export class JwtAuthGuard implements CanActivate {


	constructor(
		private readonly jwtService: JwtService,
		private readonly shopService: ShopService
	) {}


	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<Request>();
		const token = this.extractTokenFromHeader(request);
		
		if ( !token ) {
			throw new UnauthorizedException('No token provided');
		}

		try {
			const payload = await this.jwtService.verifyAsync( token, {
				secret: process.env.JWT_SECRET,
			});

			const userId = payload?.userId;

			const installedShop = await this.shopService.findByInstalledByUserId( userId );
			if ( !installedShop ) {
				throw new UnauthorizedException('Invalid token payload');
			}

			const requestedStore = this.extractStoreFromRequest(request);
			const resolvedShop = await this.resolveShopForRequest(userId, requestedStore);

			request['shop'] = resolvedShop.shop;
			request['shopDomain'] = resolvedShop.shop;

			// Attach user info to request object for use in controllers
			request['user'] = payload;
			// Also attach the raw token so controllers can access it without re-reading headers
			request['token'] = token;
			
			return true;
		} catch ( error: any ) {
			console.error('JWT verification failed:', error?.message);
			throw new UnauthorizedException('Invalid token');
		}
	}


	private extractTokenFromHeader( request: Request ): string | undefined {
		const [type, token] = request.headers.authorization?.split(' ') ?? [];
		return type === 'Bearer' ? token : undefined;
	}


	private extractStoreFromRequest(request: Request): string | null {
		const sources: Array<any> = [
			request.query?.store,
			request.query?.shop,
			request.params?.store,
			request.params?.shop,
			request.body && typeof request.body === 'object' ? request.body.store : undefined,
			request.body && typeof request.body === 'object' ? request.body.shop : undefined,
			request.headers['x-shopify-shop-domain'],
			request.headers['x-shop-domain']
		];

		for (const candidate of sources) {
			const normalized = this.normalizeStore(candidate);
			if ( normalized ) {
				return normalized;
			}
		}

		return null;
	}


	private normalizeStore(store: any): string | null {
		if ( !store ) {
			return null;
		}

		const value = Array.isArray(store) ? store[0] : store;

		if ( typeof value !== 'string' ) {
			return null;
		}

		const trimmed = value.trim();

		return trimmed ? trimmed.toLowerCase() : null;
	}


	private async resolveShopForRequest( userId: string, requestedStore: string | null) {
		if ( requestedStore ) {
			const storeDomain = this.normalizeStore(requestedStore);

			if ( !storeDomain ) {
				throw new UnauthorizedException('Invalid store identifier');
			}

			const shopRecord = await this.shopService.findByShop( storeDomain );

			if ( !shopRecord ) {
				throw new UnauthorizedException('Store not found or not installed');
			}

			if ( shopRecord.installedByUserId !== userId ) {
				throw new UnauthorizedException('User is not authorized to access this store');
			}

			return shopRecord;
		}

		const shopRecord = await this.shopService.findByInstalledByUserId( userId );

		if ( !shopRecord ) {
			throw new UnauthorizedException('User is not associated with any store');
		}

		return shopRecord;
	}
}
