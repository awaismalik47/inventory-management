import { Injectable, UnauthorizedException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { ShopService } from 'src/shop/shop.service';
import { IProductModel, IVariantModel } from 'src/models/product.model';


@Injectable()
export class ProductService {
    constructor(
        private readonly httpService: HttpService,
        private readonly shopService: ShopService
    ) {}

	private async getShop(store: string): Promise<any> {
		return await this.shopService.findByShop(store);
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



	async getProducts( store: string, limit = '50', page = '1' ): Promise<any> {
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
	  
				return {
				  id: productId,
				  title: p.title,
				  product_type: p.productType,
				  status: p.status,
				  image: { src: p.featuredImage?.url || images[0]?.src || '' },
				  images,
				  variants,
				};
			  });
	  
			  const productsWithInventory = await this.fetchInventoryForProducts(products, store, accessToken);
	  
			  return {
				page         : pageNum,
				perPage      : first,
				hasNextPage,
				nextCursor   : afterCursor,
				products     : this.getAllProductsModel( { products: productsWithInventory } ),
				totalProducts:  productsWithInventory.length,
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
			while ( hasNextPage ) {
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
						id : this.extractId(ie.node.id),
						src: ie.node.url,
					}));
		  
					const variants = (p.variants?.edges || []).map((ve: any) => {
						const v = ve.node;
						return {
							id                : this.extractId(v.id),
							title             : v.title,
							price             : v.price,
							sku               : v.sku,
							inventory_quantity: Number(v.inventoryQuantity ?? 0),
							image_id          : v.image ? this.extractId(v.image.id): null,
							product_id        : productId,
							inventory_item_id : v.inventoryItem ? this.extractId( v.inventoryItem.id ) : null,
						};
					});
		  
					return {
					  id          : productId,
					  title       : p.title,
					  product_type: p.productType,
					  status      : p.status,
					  image       : { src: p.featuredImage?.url || images[0]?.src || '' },
					  images,
					  variants,
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


    private async fetchInventoryForProducts( products: any[], store: string, accessToken: string ): Promise<any[]> {
        
        // Collect product IDs and create variant mapping
        const productIds: number[] = [];
        const variantMap = new Map<string, any>(); // key: "productId_variantId"
        
        // Optimized: Single loop through all products and variants
        for (const product of products) {
            productIds.push(product.id);
            for (const variant of product.variants) {
                // Set default values first
                variant.available = 0;
                variant.incoming = 0;
                variant.committed = 0;
                variant.on_hand = 0;
                
                // Create a map key for this variant
                const variantKey = `${product.id}_${variant.id}`;
                variantMap.set(variantKey, variant);
            }
        }
        
        if ( productIds.length === 0 ) {
            return products;
        }
        
        // Batch fetch inventory data using product-based queries (same as getInventoryLevelByProductId)
        try {
            const inventoryData = await this.fetchInventoryByProductsBatch(productIds, store, accessToken);
            
            // Apply inventory data to variants
            for (const [variantKey, data] of inventoryData.entries()) {
                const variant = variantMap.get(variantKey);
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


    private async fetchInventoryByProductsBatch(productIds: number[], store: string, accessToken: string): Promise<Map<string, any>> {
        // fetchInventoryByProducts now processes sequentially with rate limiting
        // No need for additional batching - just pass all product IDs
        return await this.fetchInventoryByProducts(productIds, store, accessToken);
    }


    /**
     * Extract inventory quantities from product data returned by getInventoryLevelByProductId
     * This ensures we use the exact same data structure and aggregation logic
     */
    private extractQuantitiesFromProductData(productId: number, productData: any): Map<string, any> {
        const result = new Map<string, any>();
        
        if (!productData || !productData.variants) {
            return result;
        }

        const variants = productData.variants?.edges || [];

        for (const variantEdge of variants) {
            const variant = variantEdge.node;
            const variantId = this.extractId(variant.id);
            const variantKey = `${productId}_${variantId}`;

            const inventoryItem = variant.inventoryItem;
            if (!inventoryItem) {
                continue;
            }

            const inventoryLevels = inventoryItem.inventoryLevels?.edges || [];
            
            // Aggregate quantities across all locations (same logic as getInventoryLevelByProductId)
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

            result.set(variantKey, aggregatedQuantities);
        }

        return result;
    }

    /**
     * Retry helper with exponential backoff for handling rate limits
     */
    private async retryWithBackoff<T>(
        fn: () => Promise<T>,
        maxRetries: number = 3,
        initialDelay: number = 1000
    ): Promise<T> {
        let lastError: any;
        
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                return await fn();
            } catch (error: any) {
                lastError = error;
                
                // Check if it's a throttling error
                const isThrottled = error?.message?.includes('Throttled') || 
                                   error?.response?.data?.errors?.some((e: any) => e.extensions?.code === 'THROTTLED');
                
                if (isThrottled && attempt < maxRetries - 1) {
                    // Exponential backoff: 1s, 2s, 4s
                    const delay = initialDelay * Math.pow(2, attempt);
                    console.log(`[retryWithBackoff] Throttled, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
                
                // If not throttled or max retries reached, throw
                throw error;
            }
        }
        
        throw lastError;
    }

    /**
     * Fetch inventory for multiple products using the same method as getInventoryLevelByProductId
     * This ensures accurate quantities by using the exact same query structure
     * Processes sequentially to avoid rate limiting
     */
    private async fetchInventoryByProducts(productIds: number[], store: string, accessToken: string): Promise<Map<string, any>> {
        
        const result = new Map<string, any>();
        const shop = await this.getShop(store);
        if (!shop) {
            throw new UnauthorizedException('Shop not found. Please complete OAuth flow first.');
        }

        // Process products sequentially to avoid rate limiting
        // Shopify GraphQL API allows ~50 cost points/second, each product query is ~10-15 points
        // Processing sequentially with delays ensures we stay within limits
        for (let i = 0; i < productIds.length; i++) {
            const productId = productIds[i];
            
            try {
                // Use retry logic with exponential backoff for throttling
                const productData = await this.retryWithBackoff(
                    () => this.getInventoryLevelByProductId(store, String(productId)),
                    3, // max 3 retries
                    1000 // initial delay 1 second
                );
                
                if (productData) {
                    const quantities = this.extractQuantitiesFromProductData(productId, productData);
                    for (const [key, value] of quantities.entries()) {
                        result.set(key, value);
                    }
                }
            } catch (error: any) {
                // Log error but continue processing other products
                const isThrottled = error?.message?.includes('Throttled') || 
                                   error?.response?.data?.errors?.some((e: any) => e.extensions?.code === 'THROTTLED');
                
                if (isThrottled) {
                    console.error(`[fetchInventoryByProducts] Throttled for product ${productId} after retries. Skipping...`);
                } else {
                    console.error(`[fetchInventoryByProducts] Error fetching inventory for product ${productId}:`, error.message);
                }
                // Continue with next product instead of failing entire batch
            }

            // Delay between requests to respect rate limits
            // 500ms delay = ~2 requests/second = ~20-30 cost points/second (well within 50 limit)
            if (i < productIds.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

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


	private extractId(gid: string): number {
		return Number(String(gid).split('/').pop());
	}

	private getVariantImage( variantId: any, images: any ): string {
		if ( !images || !variantId ) return '';

		// Use Map for O(1) lookup instead of O(n) loop
		const imagesMap = new Map(images.map((img: any) => [img.id, img.src]));
		return (imagesMap.get(variantId) as string) || '';
	}


	async getInventoryLevelByProductId( store: string, productId: string ): Promise<any> {

		const shop = await this.getShop(store);
		if (!shop) {
			throw new UnauthorizedException('Shop not found. Please complete OAuth flow first.');
		}

		const accessToken = shop.accessToken as string;

		const query = `
            query {
                product(id: "gid://shopify/Product/${productId}") {
                    id
                    title
                    variants(first: 100) {
                        edges {
                            node {
                                id
                                title
                                sku
                                inventoryItem {
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
                            }
                        }
                    }
                }
            }
        `;

		try {
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

			// Check for GraphQL errors
			if (resp.data?.errors) {
				const errors = resp.data.errors;
				// Check if any error is a throttling error
				const throttledError = errors.find((e: any) => e.extensions?.code === 'THROTTLED');
				if (throttledError) {
					const error: any = new Error(`GraphQL errors: ${JSON.stringify(errors)}`);
					error.response = { data: { errors } };
					throw error;
				}
				throw new Error(`GraphQL errors: ${JSON.stringify(errors)}`);
			}

			const data = resp.data?.data?.product;
			
			if (!data) {
				return null;
			}

			return data;
		} catch (error: any) {
			// Re-throw with proper structure for retry logic
			if (error?.response?.data?.errors) {
				const throttledError = error.response.data.errors.find((e: any) => e.extensions?.code === 'THROTTLED');
				if (throttledError) {
					throw error;
				}
			}
			throw error;
		}
	}

}