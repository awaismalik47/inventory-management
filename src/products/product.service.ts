import { Injectable, UnauthorizedException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { ShopService } from 'src/shop/shop.service';
import { IProductModel, IVariantModel } from 'src/models/product.model';


@Injectable()
export class ProductService {
    // Rate limiting configuration
    private readonly MAX_RETRIES = 5;
    private readonly INITIAL_RETRY_DELAY = 2000; // 2 seconds (increased)
    private readonly MAX_RETRY_DELAY = 60000; // 60 seconds (increased)
    private readonly RATE_LIMIT_DELAY = 1000; // 1 second between requests (increased from 500ms)
    private readonly POST_THROTTLE_DELAY = 5000; // 5 seconds delay after throttling error

    constructor(
        private readonly httpService: HttpService,
        private readonly shopService: ShopService
    ) {}

	private async getShop(store: string): Promise<any> {
		return await this.shopService.findByShop(store);
	}

	/**
	 * Make a GraphQL request with retry logic and rate limiting
	 * Handles Shopify throttling errors with exponential backoff
	 */
	private async makeGraphQLRequest(
		url: string,
		query: string,
		variables: any,
		accessToken: string,
		retryCount = 0
	): Promise<any> {
		try {
			// Add delay before each request to respect rate limits
			// Longer delay for retries to give Shopify time to recover
			if (retryCount > 0) {
				await new Promise(resolve => setTimeout(resolve, this.RATE_LIMIT_DELAY * 2));
			} else {
				await new Promise(resolve => setTimeout(resolve, this.RATE_LIMIT_DELAY));
			}

			const resp = await lastValueFrom(
				this.httpService.post(
					url,
					{ query, variables },
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
				
				// Check if it's a throttling error
				const throttledError = errors.find((err: any) => 
					err.extensions?.code === 'THROTTLED' || 
					err.message?.toLowerCase().includes('throttled')
				);

				if (throttledError && retryCount < this.MAX_RETRIES) {
					// Calculate exponential backoff delay
					const delay = Math.min(
						this.INITIAL_RETRY_DELAY * Math.pow(2, retryCount),
						this.MAX_RETRY_DELAY
					);

					// Check if Shopify provided a retry-after value
					// Headers can be in different cases
					const retryAfter = resp.headers?.['retry-after'] || 
									  resp.headers?.['Retry-After'] ||
									  resp.headers?.['x-shopify-retry-after'] ||
									  resp.headers?.['X-Shopify-Retry-After'];
					// Use retry-after if provided, otherwise use exponential backoff
					// Add extra buffer time to be safe
					const waitTime = retryAfter 
						? (parseInt(String(retryAfter)) * 1000) + 1000 // Add 1 second buffer
						: delay;

					console.log(
						`[makeGraphQLRequest] Throttled. Retrying in ${waitTime}ms (attempt ${retryCount + 1}/${this.MAX_RETRIES})`
					);

					await new Promise(resolve => setTimeout(resolve, waitTime));
					return this.makeGraphQLRequest(url, query, variables, accessToken, retryCount + 1);
				}

				// If not throttled or max retries reached, throw the error
				throw new Error(`GraphQL errors: ${JSON.stringify(errors)}`);
			}

			// Check rate limit headers for logging and dynamic adjustment
			// Headers can be in different cases, so check both
			const rateLimitHeader = resp.headers?.['x-shopify-shop-api-call-limit'] || 
									resp.headers?.['X-Shopify-Shop-Api-Call-Limit'];
			if (rateLimitHeader) {
				const [used, limit] = String(rateLimitHeader).split('/').map(Number);
				const usagePercent = (used / limit) * 100;
				
				if (usagePercent > 90) {
					console.error(
						`[makeGraphQLRequest] CRITICAL: Rate limit nearly exhausted: ${used}/${limit} (${usagePercent.toFixed(1)}%)`
					);
					// Add extra delay if we're very close to the limit
					await new Promise(resolve => setTimeout(resolve, this.RATE_LIMIT_DELAY * 2));
				} else if (usagePercent > 80) {
					console.warn(
						`[makeGraphQLRequest] Rate limit warning: ${used}/${limit} (${usagePercent.toFixed(1)}%)`
					);
					// Add moderate delay if we're approaching the limit
					await new Promise(resolve => setTimeout(resolve, this.RATE_LIMIT_DELAY));
				} else if (usagePercent > 60) {
					// Log info for monitoring
					console.log(
						`[makeGraphQLRequest] Rate limit: ${used}/${limit} (${usagePercent.toFixed(1)}%)`
					);
				}
			}

			return resp.data;
		} catch (error: any) {
			// Handle HTTP errors (429 Too Many Requests)
			if (error.response?.status === 429 && retryCount < this.MAX_RETRIES) {
				// Headers can be in different cases
				const retryAfter = error.response.headers?.['retry-after'] || 
								  error.response.headers?.['Retry-After'] ||
								  error.response.headers?.['x-shopify-retry-after'] ||
								  error.response.headers?.['X-Shopify-Retry-After'];
				const delay = retryAfter 
					? parseInt(String(retryAfter)) * 1000 
					: Math.min(
						this.INITIAL_RETRY_DELAY * Math.pow(2, retryCount),
						this.MAX_RETRY_DELAY
					);

				console.log(
					`[makeGraphQLRequest] HTTP 429. Retrying in ${delay}ms (attempt ${retryCount + 1}/${this.MAX_RETRIES})`
				);

				await new Promise(resolve => setTimeout(resolve, delay));
				return this.makeGraphQLRequest(url, query, variables, accessToken, retryCount + 1);
			}

			// Re-throw if it's not a throttling issue or max retries reached
			throw error;
		}
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
	  
			const resp = await this.makeGraphQLRequest(
				`https://${store}/admin/api/${process.env.API_VERSION}/graphql.json`,
				query,
				{ first, after: afterCursor },
				accessToken
			);
	  
			const productsData = resp?.data?.products;

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


	async getAllProducts(store: string, skipInventoryFetch: boolean = false): Promise<any> {
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
		  
				const resp = await this.makeGraphQLRequest(
					`https://${store}/admin/api/${process.env.API_VERSION}/graphql.json`,
					query,
					{ first, after: afterCursor },
					accessToken
				);
		  
				const productsData = resp?.data?.products;
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
		  
				// Add delay to respect rate limits
				// Shopify GraphQL allows 50 cost points/second (250 products = ~50 points)
				// Using RATE_LIMIT_DELAY to ensure we stay within limits
				if (hasNextPage) {
					await new Promise(resolve => setTimeout(resolve, this.RATE_LIMIT_DELAY * 2));
				}
			}
			
			console.log(`[getAllProducts] Completed fetching all products. Total products: ${allProducts.length}`);
		  
			// Fetch inventory for all products (or use basic inventoryQuantity if skipped)
			let productsWithInventory: any[];
			if (skipInventoryFetch) {
				console.log(`[getAllProducts] Skipping detailed inventory fetch. Using basic inventoryQuantity from product data.`);
				// Use inventoryQuantity as available, set incoming to 0
				productsWithInventory = allProducts.map(product => ({
					...product,
					variants: product.variants.map((variant: any) => ({
						...variant,
						available: variant.inventory_quantity || 0,
						incoming: 0,
						committed: 0,
						on_hand: variant.inventory_quantity || 0,
					}))
				}));
			} else {
				console.log(`[getAllProducts] Starting to fetch inventory for ${allProducts.length} products...`);
				productsWithInventory = await this.fetchInventoryForProducts(allProducts, store, accessToken);
				console.log(`[getAllProducts] Completed fetching inventory for all products`);
			}
		  
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
        
        console.log(`[fetchInventoryForProducts] Starting inventory fetch for ${products.length} products`);
        
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
            console.log(`[fetchInventoryForProducts] No product IDs found, returning products without inventory`);
            return products;
        }
        
        console.log(`[fetchInventoryForProducts] Processing ${productIds.length} products in batches...`);
        
        // Batch fetch inventory data using product-based queries (same as getInventoryLevelByProductId)
        try {
            const inventoryData = await this.fetchInventoryByProductsBatch(productIds, store, accessToken);
            
            console.log(`[fetchInventoryForProducts] Fetched inventory data for ${inventoryData.size} variants`);
            
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
            
            console.log(`[fetchInventoryForProducts] Applied inventory data to variants`);
        } catch (error: any) {
            console.error(`[fetchInventoryForProducts] Error fetching inventory:`, error.message);
            throw new UnauthorizedException(error.message);
            // Default values are already set above
        }
        
        return products;
    }


    private async fetchInventoryByProductsBatch(productIds: number[], store: string, accessToken: string): Promise<Map<string, any>> {
        // Process in batches of 3 products to avoid GraphQL query size limits and rate limiting
        // Reduced batch size and concurrency to better respect rate limits
        const batchSize = 3;
        const maxConcurrent = 2; // Process 2 batches at a time (reduced from 3)
        const result = new Map<string, any>();
        const totalBatches = Math.ceil(productIds.length / (batchSize * maxConcurrent));
        let currentBatchGroup = 0;
        
        console.log(`[fetchInventoryByProductsBatch] Processing ${productIds.length} products in ${totalBatches} batch groups (${batchSize} products per batch, ${maxConcurrent} concurrent batches)`);
        
        for (let i = 0; i < productIds.length; i += batchSize * maxConcurrent) {
            currentBatchGroup++;
            const processedCount = Math.min(i + (batchSize * maxConcurrent), productIds.length);
            
            console.log(`[fetchInventoryByProductsBatch] Processing batch group ${currentBatchGroup}/${totalBatches} (products ${i + 1}-${processedCount} of ${productIds.length})`);
            
            // Create batches for parallel processing
            const batchPromises: Promise<Map<string, any>>[] = [];
            
            for (let j = 0; j < maxConcurrent && (i + j * batchSize) < productIds.length; j++) {
                const batchStart = i + j * batchSize;
                const batch = productIds.slice(batchStart, batchStart + batchSize);
                
                if (batch.length > 0) {
                    batchPromises.push(this.fetchInventoryByProducts(batch, store, accessToken));
                }
            }
            
            // Wait for all batches in this group to complete
            const batchResults = await Promise.all(batchPromises);
            
            // Merge results
            let variantsInThisGroup = 0;
            for (const batchResult of batchResults) {
                for (const [key, data] of batchResult.entries()) {
                    result.set(key, data);
                    variantsInThisGroup++;
                }
            }
            
            console.log(`[fetchInventoryByProductsBatch] Completed batch group ${currentBatchGroup}/${totalBatches} (${variantsInThisGroup} variants processed, ${result.size} total variants so far)`);
            
            // Increased delay between batch groups to better respect rate limits
            if (i + (batchSize * maxConcurrent) < productIds.length) {
                await new Promise(resolve => setTimeout(resolve, this.RATE_LIMIT_DELAY * 3));
            }
        }
        
        console.log(`[fetchInventoryByProductsBatch] Completed all batch groups. Total variants processed: ${result.size}`);
        return result;
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
     * Fetch inventory for multiple products using the same method as getInventoryLevelByProductId
     * This ensures accurate quantities by using the exact same query structure
     */
    private async fetchInventoryByProducts(productIds: number[], store: string, accessToken: string): Promise<Map<string, any>> {
        
        const result = new Map<string, any>();
        const shop = await this.getShop(store);
        if (!shop) {
            throw new UnauthorizedException('Shop not found. Please complete OAuth flow first.');
        }

        // Process products sequentially to better respect rate limits
        // Reduced from parallel processing to avoid throttling
        let consecutiveThrottles = 0;
        for (let i = 0; i < productIds.length; i++) {
            const productId = productIds[i];
            
            try {
                const productData = await this.getInventoryLevelByProductId(store, String(productId));
                if (productData) {
                    const quantities = this.extractQuantitiesFromProductData(productId, productData);
                    // Merge quantities into result
                    for (const [key, value] of quantities.entries()) {
                        result.set(key, value);
                    }
                    // Reset throttle counter on success
                    consecutiveThrottles = 0;
                }
            } catch (error: any) {
                // Check if it's a throttling error
                const isThrottled = error.message?.includes('THROTTLED') || 
                                   error.message?.toLowerCase().includes('throttled') ||
                                   error.response?.status === 429;
                
                if (isThrottled) {
                    consecutiveThrottles++;
                    console.warn(
                        `[fetchInventoryByProducts] Throttled for product ${productId} (${i + 1}/${productIds.length}, consecutive: ${consecutiveThrottles}). ` +
                        `Retry logic exhausted. Adding extra delay before continuing...`
                    );
                    
                    // If we're getting consecutive throttles, add extra delay
                    if (consecutiveThrottles >= 2) {
                        const extraDelay = this.POST_THROTTLE_DELAY * consecutiveThrottles;
                        console.log(`[fetchInventoryByProducts] Adding ${extraDelay}ms delay due to consecutive throttles`);
                        await new Promise(resolve => setTimeout(resolve, extraDelay));
                    } else {
                        await new Promise(resolve => setTimeout(resolve, this.POST_THROTTLE_DELAY));
                    }
                } else {
                    // Reset on non-throttle error
                    consecutiveThrottles = 0;
                    console.error(`[fetchInventoryByProducts] Error fetching inventory for product ${productId} (${i + 1}/${productIds.length}):`, error.message);
                }
                // Continue with next product instead of failing entire batch
            }

            // Add delay between requests to respect rate limits (except for last product)
            // Increase delay if we've had recent throttles
            if (i < productIds.length - 1) {
                const delay = consecutiveThrottles > 0 
                    ? this.RATE_LIMIT_DELAY * 2 
                    : this.RATE_LIMIT_DELAY;
                await new Promise(resolve => setTimeout(resolve, delay));
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
			const resp = await this.makeGraphQLRequest(
				`https://${store}/admin/api/${process.env.API_VERSION}/graphql.json`,
				query,
				{},
				accessToken
			);

			const data = resp?.data?.product;
			
			if (!data) {
				return null;
			}

			return data;
		} catch (error) {
			throw error;
		}
	}

}