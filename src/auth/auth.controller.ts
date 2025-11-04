import { BadRequestException, Controller, Get, HttpCode, Query, Redirect, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import type { Request } from 'express';
import * as crypto from 'crypto';

// Services
import { ShopService } from 'src/shop/shop.service';
import { WebhooksService } from 'src/webhooks/webhooks.service';
import { ProductService } from 'src/products/product.service';

// Models
import type { OAuthQueryDto } from './dto/auth.dto';

@Controller('shopify-oauth')
export class AuthController {
    constructor( 
        private readonly configService: ConfigService, 
        private readonly httpService: HttpService, 
        private readonly shopService: ShopService,
        private readonly webhooksService: WebhooksService,
        private readonly productService: ProductService
    ) {}

    global_access_token: string = '';

    @Get('init')
    @HttpCode(302)
    @Redirect()
    init(@Query() query: OAuthQueryDto, @Req() req: Request) {

        throw new BadRequestException('This route is not available');

        // Validate required parameters
        if ( !query.shop ) {
            throw new Error('Shop parameter is required');
        }

        // Validate shop domain format
        const shopDomain = query.shop.includes('.myshopify.com') 
            ? query.shop 
            : `${query.shop}.myshopify.com`;
        const clientId    = this.configService.get('shopify.appProxy.clientId') as string;
        const scopes      = this.configService.get('shopify.appProxy.scopes') as string[];
        const redirectUri = `${this.configService.get('apiUrl')}/shopify-oauth/redirect`;
        const state       = 'nonce'; // You should generate a proper nonce


        const userId = (req as any).user?.id || query.userId;
        if (!userId) {
          throw new Error('User ID is required to initialize installation');
        }

        const statePayload = {
            userId,
            nonce: crypto.randomUUID(), // Prevent CSRF attacks
            timestamp: Date.now(),
        };

        const encodedState = Buffer.from(JSON.stringify(statePayload)).toString('base64url');

        const response = {
            url: `https://${shopDomain}/admin/oauth/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodedState}`
        };

        return response;
    }


    @Get('redirect')
    @HttpCode(302)
    @Redirect()
    async oauthRedirect(@Query() query: OAuthQueryDto) {
        // Validate required parameters
        if (!query.code || !query.shop) {
            throw new Error('Missing required parameters: code and shop');
        }
        
        // Validate shop domain format
        const shopDomain = query.shop.includes('.myshopify.com') 
            ? query.shop 
            : `${query.shop}.myshopify.com`;
        
        let userId: string | null = null;
        try {
            if ( query.state ) {
                const decodedState = JSON.parse(Buffer.from(query.state, 'base64url').toString());
                userId = decodedState.userId;
            }
        } catch (err) {
            console.error('Failed to decode state:', err);
        }

        try {
            const response = await lastValueFrom(
                this.httpService.post(
                    `https://${shopDomain}/admin/oauth/access_token`,
                    {
                        client_id: this.configService.get('shopify.appProxy.clientId') as string,
                        client_secret: this.configService.get('shopify.appProxy.clientSecret') as string,
                        code: query.code
                    }
                )
            );
            this.global_access_token = response.data.access_token as string;

            // Save shop data to database
            const scopes = this.configService.get('shopify.appProxy.scopes') as string[];
            const shopData = {
                shop             : shopDomain,
                accessToken      : response.data.access_token,
                scopes           : Array.isArray(scopes) ? scopes.join(','): scopes,
                installedByUserId: userId
            };

            console.log('shopData', shopData);
            
            await this.shopService.upsertShop( shopData as any );
            
            // Clear cached shop data to ensure fresh access token is used
            this.productService.clearShopCache(shopDomain);
            
            // // Register webhooks after successful OAuth
            // try {
            //     await this.webhooksService.registerAllWebHooks(shopDomain, response.data.access_token);
            //     console.log('✅ All webhooks registered successfully');
            // } catch (webhookError) {
            //     console.error('❌ Failed to register webhooks:', webhookError);
            //     // Don't fail the OAuth flow if webhook registration fails
            // }
            
            return {
              url: `http://192.168.5.110:4200/main/items`
            };
        } catch (error) {
            console.error('OAuth error:', error.response?.data as any || error.message as string);
            throw new Error('Failed to exchange authorization code for access token');
        }
    }


}

