import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { ShopService } from 'src/shop/shop.service';
import { IOptionModel, IProductModel, IVariantModel } from 'src/models/product.model';

// Simple in-memory cache
const shopCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes


@Injectable()
export class ProductService {
    constructor(
        private readonly httpService: HttpService,
        private readonly shopService: ShopService
    ) {}

    /**
     * Clear cached shop data for a specific store
     * This should be called when access tokens are updated
     */
    clearShopCache(store: string): void {
        const cacheKey = `shop_${store}`;
        shopCache.delete(cacheKey);
        console.log(`Cache cleared for shop: ${store}`);
    }

    /**
     * Clear all cached shop data
     * This can be called during logout or when needed
     */
    clearAllShopCache(): void {
        shopCache.clear();
        console.log('All shop cache cleared');
    }

    async getProducts(store: string, limit: string = '50'): Promise<any> {
        // Check cache first
        const cacheKey = `shop_${store}`;
        const cached = shopCache.get(cacheKey);
        let shop;
        
        if ( cached && (Date.now() - cached.timestamp) < CACHE_TTL ) {
            shop = cached.data;
        } else {
            shop = await this.shopService.findByShop(store);
            if ( shop ) {
                shopCache.set(cacheKey, { data: shop, timestamp: Date.now() });
            }
        }
        
        if ( !shop ) {
            return {
                error: 'Shop not found. Please complete OAuth flow first.',
                instructions: 'Visit /shopify-oauth/init?shop=your-store.myshopify.com first'
            };
        }
        const accessToken = shop.accessToken || process.env.SHOPIFY_ACCESS_TOKEN;

		try {
			const first = Math.max(1, Math.min(250, Number(limit) || 50));
			const query = `
				query ($first: Int!) {
					products(first: $first) {
						edges {
							node {
								id
								title
								productType
								status
								featuredImage { url }
								images(first: 100) { edges { node { id url } } }
								options { id name values }
								variants(first: 100) {
									edges {
										node {
											id
											title
											price
											sku
											inventoryQuantity
											inventoryItem { id }
											image { id url }
											product { id }
										}
									}
								}
							}
						}
					}
				}
			`;

			const resp = await lastValueFrom(
				this.httpService.post(
					`https://${store}/admin/api/${process.env.API_VERSION}/graphql.json`,
					{ query, variables: { first } },
					{ headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' } }
				)
			);

			const edges = resp.data?.data?.products?.edges || [];
			// Transform GraphQL → REST-like shape expected by getAllProductsModel
			const products = edges.map((e: any) => {
				const p = e.node;
				const productId = this.extractId(p.id);
				
				// Pre-compute images map for faster variant image lookup
				const images = (p.images?.edges || []).map((ie: any) => ({
					id: this.extractId(ie.node.id),
					src: ie.node.url,
				}));
				const imagesMap = new Map(images.map(img => [img.id, img.src]));
				
				const featuredSrc = p.featuredImage?.url || (images[0]?.src ?? '');
				
				const variants = (p.variants?.edges || []).map((ve: any) => {
					const v = ve.node;
					return {
						id: this.extractId(v.id),
						title: v.title,
						price: v.price,
						sku: v.sku,
						inventory_quantity: Number(v.inventoryQuantity ?? 0),
						old_inventory_quantity: 0,
						image_id: v.image ? this.extractId(v.image.id) : null,
						product_id: productId,
						inventory_item_id: v.inventoryItem ? this.extractId(v.inventoryItem.id) : null,
					};
				});
				
				const options = (p.options || []).map((o: any) => ({
					id: this.extractId(o.id),
					product_id: productId,
					name: o.name,
					values: o.values,
				}));

				return {
					id: productId,
					title: p.title,
					product_type: p.productType,
					status: p.status,
					image: { src: featuredSrc },
					images,
					variants,
					options,
				};
			});

			// Fetch inventory data for all variants
			const productsWithInventory = await this.fetchInventoryForProducts(products, store, accessToken);
			return this.getAllProductsModel({ products: productsWithInventory });
		} catch (error) {
			throw new Error('Failed to fetch products');
		}
    }


    private async fetchInventoryForProducts(products: any[], store: string, accessToken: string): Promise<any[]> {
        
        // Collect all inventory item IDs
        const inventoryItemIds: number[] = [];
        const variantMap = new Map<number, any>();
        
        for ( const product of products ) {
            for ( const variant of product.variants ) {
                if ( variant.inventory_item_id ) {
                    inventoryItemIds.push(variant.inventory_item_id);
                    variantMap.set(variant.inventory_item_id, variant);
                }
				// Set default values
				variant.available = 0;
				variant.incoming = 0;
				variant.committed = 0;
				variant.on_hand = 0;
			}
        }
        
        if ( inventoryItemIds.length === 0 ) {
            return products;
        }
        
        // Batch fetch inventory data
        try {
            const inventoryData = await this.fetchInventoryLevelsBatch(inventoryItemIds, store, accessToken);
            
            // Apply inventory data to variants
            for (const [inventoryItemId, data] of inventoryData.entries()) {
                const variant = variantMap.get(inventoryItemId);
                if (variant) {
                    variant.available = data.available || 0;
                    variant.incoming = data.incoming || 0;
                    variant.committed = data.committed || 0;
                    variant.on_hand = data.on_hand || 0;
                }
            }
        } catch (error) {
			throw new Error('Failed to fetch inventory data');
            // Default values are already set above
        }
        
        return products;
    }


    private async fetchInventoryLevelsBatch(inventoryItemIds: number[], store: string, accessToken: string): Promise<Map<number, any>> {
        // Process in batches of 10 to avoid GraphQL query size limits
        const batchSize = 10;
        const result = new Map<number, any>();
        
        for (let i = 0; i < inventoryItemIds.length; i += batchSize) {
            const batch = inventoryItemIds.slice(i, i + batchSize);
            const batchResult = await this.fetchInventoryBatch(batch, store, accessToken);
            
            for (const [id, data] of batchResult.entries()) {
                result.set(id, data);
            }
        }
        
        return result;
    }


    private async fetchInventoryBatch(inventoryItemIds: number[], store: string, accessToken: string): Promise<Map<number, any>> {
        // Build a single GraphQL query for multiple inventory items
        const queryParts = inventoryItemIds.map((id, index) => `
            inventoryItem${index}: inventoryItem(id: "gid://shopify/InventoryItem/${id}") {
                id
                inventoryLevels(first: 10) {
                    edges {
                        node {
                            id
                            quantities(names: ["available", "incoming", "committed", "on_hand"]) {
                                name
                                quantity
                            }
                            location {
                                id
                                name
                            }
                        }
                    }
                }
            }
        `);

        const query = `query { ${queryParts.join('')} }`;

        const resp = await lastValueFrom(
            this.httpService.post(
                `https://${store}/admin/api/${process.env.API_VERSION}/graphql.json`,
                { query },
                { 
                    headers: { 
                        'X-Shopify-Access-Token': accessToken, 
                        'Content-Type': 'application/json' 
                    } 
                }
            )
        );

        const result = new Map<number, any>();
        const data = resp.data?.data || {};

        inventoryItemIds.forEach((id, index) => {
            const inventoryItem = data[`inventoryItem${index}`];
            const inventoryLevels = inventoryItem?.inventoryLevels?.edges || [];
            
            // Aggregate quantities across all locations
            const aggregatedQuantities = {
                available: 0,
                incoming: 0,
                committed: 0,
                on_hand: 0
            };

            for (const level of inventoryLevels) {
                const quantities = level.node.quantities || [];
                for (const qty of quantities) {
                    if (qty.name in aggregatedQuantities) {
                        aggregatedQuantities[qty.name] += qty.quantity || 0;
                    }
                }
            }

            result.set(id, aggregatedQuantities);
        });

        return result;
    }
	

	getAllProductsModel( res: any ): IProductModel[] {
		if ( !res ) return [];

		const products: IProductModel[] = [];
		
		for ( const product of res.products ) {
			const model: IProductModel = {
				id         : product.id as number,
				title      : product.title,
				productType: product.product_type,
				status     : product.status,
				variants   : this.getVariantsModel( product.variants, product.images ),
				options    : this.getOptionsModel( product.options ),
				imageUrl   : product.image.src,
			};

		   products.push( model );
		}
		return products;
	}


	private getVariantsModel( variants: any, images: any ): IVariantModel[] {
		if ( !variants ) return [];
		const variantsModel: IVariantModel[] = [];

		for ( const variant of variants ) {
			const model: IVariantModel = {
				id                  : variant.id as number,
				productId           : variant.product_id as number,
				imageSrc            : this.getVariantImage( variant.image_id, images ),
				title               : variant.title,
				price               : variant.price,
				sku                 : variant.sku,
				inventoryQuantity   : variant.inventory_quantity as number,
				oldInventoryQuantity: variant.old_inventory_quantity as number,
				inventory_item_id   : variant.inventory_item_id as number,
				available           : variant.available as number,
				incoming            : variant.incoming as number,
				on_hand             : variant.on_hand as number,
				committed           : variant.committed as number,
			};
			variantsModel.push( model );
		}
		return variantsModel;
	}


	private getOptionsModel( options: any ): IOptionModel[] {
		if ( !options ) return [];
		const optionsModel: IOptionModel[] = [];

		for ( const option of options ) {
			const model: IOptionModel = {
				id       : option.id as number,
				productId: option.product_id as number,
				name     : option.name,
				values   : option.values,
			};
			optionsModel.push( model );
		}
		return optionsModel;
	}


	private extractId(gid: string): number {
		return Number(String(gid).split('/').pop());
	}

	private getVariantImage( variantId: any, images: any ): string {
		if ( !images || !variantId ) return '';

		// Use Map for O(1) lookup instead of O(n) loop
		const imagesMap = new Map(images.map((img: any) => [img.id, img.src]));
		return (imagesMap.get(variantId) as string) || '';
	}


	async processProductUpdate(productData: any): Promise<void> {
		console.log('processProductUpdate', productData);
	}

	async processInventoryUpdate(inventoryData: any): Promise<void> {
		console.log('processInventoryUpdate', inventoryData);
	}
	
	async processInventoryCreate(inventoryData: any): Promise<void> {
		console.log('processInventoryCreate', inventoryData);
	}

	async processInventoryDelete(inventoryData: any): Promise<void> {
		console.log('processInventoryDelete', inventoryData);
	}
}