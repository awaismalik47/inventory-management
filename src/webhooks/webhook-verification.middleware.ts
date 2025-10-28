import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';

@Injectable()
export class WebhookVerificationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    console.log('Webhook verification middleware');
    const hmac = req.get('X-Shopify-Hmac-Sha256');
    const body = req.body;
    const shopifyWebhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET;

    if (!hmac || !shopifyWebhookSecret) {
      throw new UnauthorizedException('Missing webhook verification data');
    }

    // Convert body to string if it's an object
    const bodyString = typeof body === 'string' ? body : JSON.stringify(body);
    
    // Create HMAC hash
    const hash = crypto
      .createHmac('sha256', shopifyWebhookSecret)
      .update(bodyString, 'utf8')
      .digest('base64');

    // Compare hashes
    if (hash !== hmac) {
      throw new UnauthorizedException('Webhook verification failed');
    }

    next();
  }
}
