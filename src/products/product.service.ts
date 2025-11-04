import { Injectable, UnauthorizedException } from '@nestjs/common';
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
    }

    /**
     * Clear all cached shop data
     * This can be called during logout or when needed
     */
    clearAllShopCache(): void {
        shopCache.clear();
    }


	private async getShop(store: string): Promise<any> {
		const cacheKey = `shop_${store}`;
		let shop = shopCache.get(cacheKey)?.data;
		if (!shop || Date.now() - (shopCache.get(cacheKey)?.timestamp || 0) > CACHE_TTL) {
			shop = await this.shopService.findByShop(store);
			if (shop) shopCache.set(cacheKey, { data: shop, timestamp: Date.now() });
		}
		return shop;
	}

	async  getTotalProducts( store: string ) {

		const shop = await this.getShop(store);
		if (!shop) {
			throw new UnauthorizedException('Shop not found. Please complete OAuth flow first.');
		}

		const accessToken = shop.accessToken as string;
		const url = `https://${store}/admin/api/${process.env.API_VERSION}/graphql.json`;
	  
		const query = `
		  {
			productsCount(query: "status:active") {
			  count
			  precision
			}
		  }
		`;
	  
		const response = await fetch(url, {
		  method: 'POST',
		  headers: {
			'Content-Type': 'application/json',
			'X-Shopify-Access-Token': accessToken,
		  },
		  body: JSON.stringify({ query }),
		});
	  
		const data = await response.json();
		return data.data.productsCount;	
	}



	async getProducts(store: string, limit = '50', page = '1'): Promise<any> {
		const shop = await this.getShop(store);
		if (!shop) {
			throw new UnauthorizedException('Shop not found. Please complete OAuth flow first.');
		}
	  
		const accessToken = shop.accessToken as string;
		const first = Math.max(1, Math.min(250, Number(limit) || 50));
		const pageNum = Math.max(1, Number(page) || 1);
	  
		// Cursor pagination
		let afterCursor: string | null = null;
		let hasNextPage = true;
		let lastCursor: string | null = null;
	  
		try {
		  for (let i = 1; i <= pageNum && hasNextPage; i++) {
			const query = `
			  query ($first: Int!, $after: String) {
				products(first: $first, after: $after, query: "status:active") {
				  edges {
					cursor
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
				  pageInfo {
					hasNextPage
					endCursor
				  }
				}
			  }
			`;
	  
			const resp = await lastValueFrom(
			  this.httpService.post(
				`https://${store}/admin/api/${process.env.API_VERSION}/graphql.json`,
				{ query, variables: { first, after: afterCursor } },
				{ headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' } }
			  )
			);
	  
			const productsData = resp.data?.data?.products;

			console.log(productsData);
			hasNextPage = productsData?.pageInfo?.hasNextPage || false;
			afterCursor = productsData?.pageInfo?.endCursor || null;
	  
			// Only return the final page data
			if (i === pageNum) {
			  const edges = productsData?.edges || [];
	  
			  const products = edges.map((e: any) => {
				console.log(e);
				const p = e.node;
				const productId = this.extractId(p.id);
	  
				const images = (p.images?.edges || []).map((ie: any) => ({
				  id: this.extractId(ie.node.id),
				  src: ie.node.url,
				}));
	  
				const variants = (p.variants?.edges || []).map((ve: any) => {
				  const v = ve.node;
				  return {
					id: this.extractId(v.id),
					title: v.title,
					price: v.price,
					sku: v.sku,
					inventory_quantity: Number(v.inventoryQuantity ?? 0),
					image_id: v.image ? this.extractId(v.image.id) : null,
					product_id: productId,
					inventory_item_id: v.inventoryItem
					  ? this.extractId(v.inventoryItem.id)
					  : null,
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
				  image: { src: p.featuredImage?.url || images[0]?.src || '' },
				  images,
				  variants,
				  options,
				};
			  });
	  
			  const productsWithInventory = await this.fetchInventoryForProducts(products, store, accessToken);
	  
			  return {
				page: pageNum,
				perPage: first,
				hasNextPage,
				nextCursor: afterCursor,
				products: this.getAllProductsModel({ products: productsWithInventory }),
				totalProducts: productsWithInventory.length,
			  };
			}
		  }
	  
		  return []; // fallback
		} catch (error: any) {
		  const errorMessage = error?.response?.data ? JSON.stringify(error.response.data) : error?.message || 'Unknown error';
		  throw new UnauthorizedException(errorMessage);
		}
	  }


	async getAllProducts(store: string): Promise<any> {
		const shop = await this.getShop(store);
		if (!shop) {
			throw new UnauthorizedException('Shop not found. Please complete OAuth flow first.');
		}
	  
		const accessToken = shop.accessToken as string;
		const first = 250; // Maximum allowed by Shopify GraphQL API
		let afterCursor: string | null = null;
		let hasNextPage = true;
		const allProducts: any[] = [];
		let pageCount = 0;
	  
		try {
			console.log(`[getAllProducts] Starting to fetch all products for store: ${store}`);
			while (hasNextPage) {
				pageCount++;
				const query = `
				  query ($first: Int!, $after: String) {
					products(first: $first, after: $after, query: "status:active") {
					  edges {
						cursor
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
					  pageInfo {
						hasNextPage
						endCursor
					  }
					}
				  }
				`;
		  
				const resp = await lastValueFrom(
				  this.httpService.post(
					`https://${store}/admin/api/${process.env.API_VERSION}/graphql.json`,
					{ query, variables: { first, after: afterCursor } },
					{ headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' } }
				  )
				);
		  
				const productsData = resp.data?.data?.products;
				const edges = productsData?.edges || [];
		  
				const products = edges.map((e: any) => {
					const p = e.node;
					const productId = this.extractId(p.id);
		  
					const images = (p.images?.edges || []).map((ie: any) => ({
					  id: this.extractId(ie.node.id),
					  src: ie.node.url,
					}));
		  
					const variants = (p.variants?.edges || []).map((ve: any) => {
					  const v = ve.node;
					  return {
						id: this.extractId(v.id),
						title: v.title,
						price: v.price,
						sku: v.sku,
						inventory_quantity: Number(v.inventoryQuantity ?? 0),
						image_id: v.image ? this.extractId(v.image.id) : null,
						product_id: productId,
						inventory_item_id: v.inventoryItem
						  ? this.extractId(v.inventoryItem.id)
						  : null,
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
					  image: { src: p.featuredImage?.url || images[0]?.src || '' },
					  images,
					  variants,
					  options,
					};
				});
		  
				allProducts.push(...products);
		  
				hasNextPage = productsData?.pageInfo?.hasNextPage || false;
				afterCursor = productsData?.pageInfo?.endCursor || null;
		  
				console.log(`[getAllProducts] Fetched page ${pageCount}: ${products.length} products (Total so far: ${allProducts.length})`);
		  
				// Reduced delay: Shopify GraphQL allows 50 cost points/second (250 products = ~50 points)
				// 100ms delay allows ~10 requests/second, well within limits
				if (hasNextPage) {
					await new Promise(resolve => setTimeout(resolve, 100));
				}
			}
			
			console.log(`[getAllProducts] Completed fetching all products. Total products: ${allProducts.length}`);
		  
			// Fetch inventory for all products
			const productsWithInventory = await this.fetchInventoryForProducts(allProducts, store, accessToken);
		  
			return {
				products: this.getAllProductsModel({ products: productsWithInventory }),
				totalProducts: productsWithInventory.length,
			};
		} catch (error: any) {
			const errorMessage = error?.response?.data ? JSON.stringify(error.response.data) : error?.message || 'Unknown error';
			throw new UnauthorizedException(errorMessage);
		}
	}


    private async fetchInventoryForProducts(products: any[], store: string, accessToken: string): Promise<any[]> {
        
        // Collect all inventory item IDs - optimized single loop
        const inventoryItemIds: number[] = [];
        const variantMap = new Map<number, any>();
        
        // Optimized: Single loop through all products and variants
        for (const product of products) {
            for (const variant of product.variants) {
                // Set default values first
                variant.available = 0;
                variant.incoming = 0;
                variant.committed = 0;
                variant.on_hand = 0;
                
                // Collect inventory item IDs if available
                if (variant.inventory_item_id) {
                    inventoryItemIds.push(variant.inventory_item_id);
                    variantMap.set(variant.inventory_item_id, variant);
                }
            }
        }
        
        if ( inventoryItemIds.length === 0 ) {
            return products;
        }
        
        // Batch fetch inventory data with parallel processing
        try {
            const inventoryData = await this.fetchInventoryLevelsBatch(inventoryItemIds, store, accessToken);
            
            // Apply inventory data to variants - optimized Map lookup
            for ( const [inventoryItemId, data] of inventoryData.entries() ) {
                const variant = variantMap.get(inventoryItemId);
                if (variant) {
                    variant.available = data.available || 0;
                    variant.incoming = data.incoming || 0;
                    variant.committed = data.committed || 0;
                    variant.on_hand = data.on_hand || 0;
                }
            }
        } catch (error) {
			throw new UnauthorizedException(error.message);
            // Default values are already set above
        }
        
        return products;
    }


    private async fetchInventoryLevelsBatch(inventoryItemIds: number[], store: string, accessToken: string): Promise<Map<number, any>> {
        // Process in batches of 10 to avoid GraphQL query size limits
        // Optimized: Process multiple batches in parallel (up to 5 concurrent batches)
        const batchSize = 10;
        const maxConcurrent = 5; // Process 5 batches at a time
        const result = new Map<number, any>();
        
        for (let i = 0; i < inventoryItemIds.length; i += batchSize * maxConcurrent) {
            // Create batches for parallel processing
            const batchPromises: Promise<Map<number, any>>[] = [];
            
            for (let j = 0; j < maxConcurrent && (i + j * batchSize) < inventoryItemIds.length; j++) {
                const batchStart = i + j * batchSize;
                const batch = inventoryItemIds.slice(batchStart, batchStart + batchSize);
                
                if (batch.length > 0) {
                    batchPromises.push(this.fetchInventoryBatch(batch, store, accessToken));
                }
            }
            
            // Wait for all batches in this group to complete
            const batchResults = await Promise.all(batchPromises);
            
            // Merge results
            for (const batchResult of batchResults) {
                for (const [id, data] of batchResult.entries()) {
                    result.set(id, data);
                }
            }
            
            // Small delay between batch groups to avoid rate limiting
            if (i + (batchSize * maxConcurrent) < inventoryItemIds.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        return result;
    }


    private async fetchInventoryBatch( inventoryItemIds: number[], store: string, accessToken: string ): Promise<Map<number, any>> {
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
				sku        : product.sku,
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

}