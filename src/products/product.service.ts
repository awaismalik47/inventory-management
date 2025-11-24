import { Injectable, UnauthorizedException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ShopService } from 'src/shop/shop.service';
import { IProductModel, IVariantModel } from 'src/models/product.model';
import { TrackIncoming, TrackIncomingDocument } from 'src/schema/incoming-history.schema';


@Injectable()
export class ProductService {
    // Rate limiting configuration
    private readonly MAX_RETRIES = 5;
    private readonly INITIAL_RETRY_DELAY = 2000; // 2 seconds (increased)
    private readonly MAX_RETRY_DELAY = 60000; // 60 seconds (increased)
    private readonly RATE_LIMIT_DELAY = 1000; // 1 second between requests (increased from 500ms)
	private readonly POST_THROTTLE_DELAY = 5000; // 5 seconds delay after throttling error
	private readonly INVENTORY_BATCH_SIZE = 50;
	private readonly INVENTORY_MAX_CONCURRENT_BATCHES = 2;
	private readonly inventoryItemsQuery = `
		query inventoryItems($ids: [ID!]!) {
			nodes(ids: $ids) {
				... on InventoryItem {
					id
					inventoryLevels(first: 10) {
						edges {
							node {
								quantities(names: ["available", "incoming", "committed", "on_hand"]) {
									name
									quantity
								}
							}
						}
					}
				}
			}
		}
	`;

    constructor(
        private readonly httpService: HttpService,
        private readonly shopService: ShopService,
        @InjectModel(TrackIncoming.name) private trackIncomingModel: Model<TrackIncomingDocument>
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

	async  getTotalProducts( store: string, status: string ) {

		const shop = await this.getShop(store);
		if ( !shop ) {
			throw new UnauthorizedException('Shop not found. Please complete OAuth flow first.');
		}

		const accessToken = shop.accessToken as string;
		const url = `https://${store}/admin/api/${process.env.API_VERSION}/graphql.json`;
	  
		const query = `
		  {
			productsCount(query: "status:${status}") {
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
					node {
					  id
					  title
					  productType
					  status
					  featuredImage { url }
					  images(first: 10) { edges { node { id url } } }
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


	async getAllProducts(store: string, status: string, skipInventoryFetch: boolean = false, skipPersist: boolean = true ): Promise<any> {
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
					products(first: $first, after: $after, query: "status:${status}") {
					  edges {
						node {
						  id
						  title
						  productType
						  status
						  featuredImage { url }
						  images(first: 10) { edges { node { id url } } }
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
			if ( skipInventoryFetch ) {
				console.log(`[getAllProducts] Skipping detailed inventory fetch. Using basic inventoryQuantity from product data.`);
				// Use inventoryQuantity as available, set incoming to 0
				productsWithInventory = allProducts.map(product => ({
					...product,
					variants: product.variants.map((variant: any) => ({
						...variant,
						available: variant.available_quantity || 0,
						incoming: variant.incoming_quantity || 0,
						committed: variant.committed_quantity || 0,
						on_hand: variant.on_hand_quantity || 0,
					}))
				}));
			} else {
				console.log(`[getAllProducts] Starting to fetch inventory for ${allProducts.length} products...`);
				productsWithInventory = await this.fetchInventoryForProducts( allProducts, store, accessToken );
				console.log(`[getAllProducts] Completed fetching inventory for all products`);
			}

			const modelData = this.getAllProductsModel({ products: productsWithInventory });
			if ( !skipPersist ) {
				await this.persistInventoryForProducts( modelData, store );
			}
		  
			return {
				products: modelData,
				totalProducts: productsWithInventory.length,
			};
		} catch (error: any) {
			const errorMessage = error?.response?.data ? JSON.stringify(error.response.data) : error?.message || 'Unknown error';
			throw new UnauthorizedException(errorMessage);
		}
	}


    private async fetchInventoryForProducts( products: any[], store: string, accessToken: string ): Promise<any[]> {
        
        console.log(`[fetchInventoryForProducts] Starting inventory fetch for ${products.length} products`);
        
		// Collect inventory item IDs and create variant mapping
		const variantMap = new Map<string, any>(); // key: "productId_variantId"
		const inventoryItemMap = new Map<number, string>(); // key: inventoryItemId -> variantKey
		const inventoryItemIds: number[] = [];
        
        // Optimized: Single loop through all products and variants
        for (const product of products) {
            for (const variant of product.variants) {
                // Set default values first
                variant.available = 0;
                variant.incoming = 0;
                variant.committed = 0;
                variant.on_hand = 0;
                
                // Create a map key for this variant
                const variantKey = `${product.id}_${variant.id}`;
                variantMap.set(variantKey, variant);

                if (variant.inventory_item_id) {
                    const inventoryItemId = Number(variant.inventory_item_id);
                    inventoryItemMap.set(inventoryItemId, variantKey);
                    inventoryItemIds.push(inventoryItemId);
                }
            }
        }
        
		const uniqueInventoryItemIds = Array.from(new Set(inventoryItemIds));

		if ( uniqueInventoryItemIds.length === 0 ) {
            console.log(`[fetchInventoryForProducts] No inventory item IDs found, returning products without inventory`);
            return products;
        }
        
		console.log(`[fetchInventoryForProducts] Processing ${uniqueInventoryItemIds.length} inventory items in batches...`);
        
        // Batch fetch inventory data using inventory item based queries
        try {
			const inventoryData = await this.fetchInventoryByInventoryItems(uniqueInventoryItemIds, store, accessToken);

            console.log(`[fetchInventoryForProducts] Fetched inventory data for ${inventoryData.size} inventory items`);

            for (const [inventoryItemId, data] of inventoryData.entries()) {
                const variantKey = inventoryItemMap.get(inventoryItemId);
                if (!variantKey) continue;

                const variant = variantMap.get(variantKey);
                if (!variant) continue;

                variant.available = data.available || 0;
                variant.incoming = data.incoming || 0;
                variant.committed = data.committed || 0;
                variant.on_hand = data.on_hand || 0;
            }
            
            console.log(`[fetchInventoryForProducts] Applied inventory data to variants`);
        } catch (error: any) {
            console.error(`[fetchInventoryForProducts] Error fetching inventory:`, error.message);
            throw new UnauthorizedException(error.message);
            // Default values are already set above
        }
        
        return products;
    }


	private async fetchInventoryByInventoryItems(inventoryItemIds: number[], store: string, accessToken: string): Promise<Map<number, any>> {
		const result = new Map<number, any>();

		if (!inventoryItemIds.length) {
			return result;
		}

		const batches: number[][] = [];
		for (let i = 0; i < inventoryItemIds.length; i += this.INVENTORY_BATCH_SIZE) {
			batches.push(inventoryItemIds.slice(i, i + this.INVENTORY_BATCH_SIZE));
		}

		const queue = [...batches];
		let batchGroup = 0;

		while (queue.length) {
			batchGroup++;
			const currentGroup = queue.splice(0, this.INVENTORY_MAX_CONCURRENT_BATCHES);

			const responses = await Promise.allSettled(
				currentGroup.map(batch => this.fetchInventoryItemsBatch(batch, store, accessToken))
			);

			let throttled = false;
			const retryBatches: number[][] = [];

			responses.forEach((response, index) => {
				const batch = currentGroup[index];

				if (response.status === 'fulfilled') {
					const dataMap = response.value;
					for (const [key, value] of dataMap.entries()) {
						result.set(key, value);
					}
					return;
				}

				const error: any = response.reason;
				if (this.isThrottledError(error)) {
					throttled = true;
					retryBatches.push(batch);
					console.warn(`[fetchInventoryByInventoryItems] Throttled on batch group ${batchGroup}. Re-queueing batch of ${batch.length} items.`);
				} else {
					console.error(`[fetchInventoryByInventoryItems] Error fetching inventory batch:`, error?.message || error);
					throw error;
				}
			});

			if (retryBatches.length) {
				queue.unshift(...retryBatches);
			}

			if (queue.length) {
				const delay = throttled ? this.POST_THROTTLE_DELAY : this.RATE_LIMIT_DELAY;
				await new Promise(resolve => setTimeout(resolve, delay));
			}
		}

		return result;
	}

	private async fetchInventoryItemsBatch(batch: number[], store: string, accessToken: string): Promise<Map<number, any>> {
		const inventoryItemGids = batch.map(id => `gid://shopify/InventoryItem/${id}`);
		const response = await this.makeGraphQLRequest(
			`https://${store}/admin/api/${process.env.API_VERSION}/graphql.json`,
			this.inventoryItemsQuery,
			{ ids: inventoryItemGids },
			accessToken
		);

		const nodes = response?.data?.nodes || [];
		const aggregatedMap = new Map<number, any>();

		for (const node of nodes) {
			if (!node?.id) continue;
			const inventoryItemId = this.extractId(node.id);
			const inventoryLevels = node.inventoryLevels?.edges || [];

			const aggregated = {
				available: 0,
				incoming: 0,
				committed: 0,
				on_hand: 0
			};

			for ( const level of inventoryLevels ) {
				const quantities = level.node?.quantities || [];
				for ( const qty of quantities ) {
					if ( qty?.name in aggregated ) {
						aggregated[qty.name as keyof typeof aggregated] += qty?.quantity || 0;
					}
				}
			}

			aggregatedMap.set(inventoryItemId, aggregated);
		}

		return aggregatedMap;
	}

	private isThrottledError(error: any): boolean {
		if (!error) return false;
		const message = error?.message?.toLowerCase?.() || '';
		return message.includes('throttled') || error?.response?.status === 429;
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


	// private async persistInventoryForProducts(products: any[], store: string): Promise<void> {
	// 	console.log(`[persistInventoryForProducts] Persisting variants for ${products.length} products`);
	
	// 	// Build variant map efficiently in a single pass
	// 	const variantMap = new Map<number, any>();
	// 	const variantIds: number[] = [];
	
	// 	for ( const product of products ) {
	// 		if ( !product.variants || product.variants.length === 0 ) continue;
	
	// 		for ( const variant of product.variants ) {
	// 			if ( !variant.id ) continue;
				
	// 			// Ensure we have a valid inventory item id
	// 			const inventoryItemId = variant.inventory_item_id ? Number( variant.inventory_item_id ) : null;
	// 			if ( inventoryItemId === null || Number.isNaN(inventoryItemId )) continue;
	
	// 			// Use productId from the model format (camelCase)
	// 			const productId = variant.productId ? Number( variant.productId ) : Number(product.id);
	// 			if (!productId) continue;
	
	// 		const variantId = Number(variant.id);
			
	// 		// Store variant data and collect IDs for batch fetch
	// 		variantMap.set(variantId, {
	// 			shop: store,
	// 			inventoryItemId,
	// 			variantId,
	// 			productId,
	// 			incoming: Number(variant.incoming || 0),
	// 			committed: Number(variant.committed || 0), // Track ordered/committed quantity
	// 		});
			
	// 		variantIds.push(variantId);
	// 		}
	// 	}
	
	// 	if (variantMap.size === 0) {
	// 		console.log(`[persistInventoryForProducts] No variants to persist`);
	// 		return;
	// 	}
	
	// 	// Fetch existing records in a single query
	// 	const existingRecords = await this.trackIncomingModel.find({
	// 		shop: store,
	// 		variantId: { $in: variantIds }
	// 	}).lean();
		
	// 	// Build existing records map for O(1) lookup
	// 	const existingMap = new Map();
	// 	for (const record of existingRecords) {
	// 		existingMap.set(record.variantId, record);
	// 	}
	
	// // Build bulk operations with date tracking logic
	// const bulkOps: any[] = [];
	// const variantsToDelete: number[] = [];
	
	// for ( const [variantId, variant] of variantMap.entries() ) {
	// 	const existing    = existingMap.get(variantId);
	// 	const oldIncoming = existing?.incoming || 0;
	// 	const newIncoming = variant.incoming;
		
	// 	// If incoming is 0 or negative, skip saving and mark for deletion if exists
	// 	if (newIncoming <= 0) {
	// 		if (existing) {
	// 			variantsToDelete.push(variantId);
	// 		}
	// 		continue; // Skip this variant, don't save it
	// 	}
		
	// 	// Only proceed if newIncoming > 0
	// 	let incomingLastChangedAt;
	// 	const updateData: any = { ...variant };
		
	// 	// Logic for tracking when incoming changes (only positive values)
	// 	if (oldIncoming === 0) {
	// 		// Changed from 0 to positive - record in history
	// 		incomingLastChangedAt = new Date();
	// 		const historyEntry = {
	// 			date: incomingLastChangedAt,
	// 			quantity: newIncoming, // Total quantity added (e.g., 0 to 5, quantity is 5)
	// 			totalOrderQuantity: variant.incoming || 0 // incoming = total ordered quantity
	// 		};
	// 		updateData.$push = { incomingHistory: historyEntry };
	// 	} else if (oldIncoming > 0 && newIncoming > oldIncoming) {
	// 		// Incoming increased - add new history entry
	// 		incomingLastChangedAt = new Date();
	// 		const quantity = newIncoming - oldIncoming; // e.g., 5 to 8, quantity is 3
	// 		const historyEntry = {
	// 			date: incomingLastChangedAt,
	// 			quantity: quantity,
	// 			totalOrderQuantity: variant.incoming || 0 // incoming = total ordered quantity
	// 		};
	// 		updateData.$push = { incomingHistory: historyEntry };
	// 	} else if (oldIncoming > 0 && newIncoming < oldIncoming) {
	// 		// Incoming decreased - items received, remove matching purchase order entry
	// 		incomingLastChangedAt = new Date();
	// 		const decreaseAmount = oldIncoming - newIncoming; // Amount received
	// 		// Get existing history and sort by date ascending (oldest first)
	// 		const existingHistory = (existing?.incomingHistory || []).sort((a: any, b: any) => {
	// 			return new Date(a.date).getTime() - new Date(b.date).getTime();
	// 		});
	// 		const updatedHistory: any[] = [];
	// 		let foundMatch = false;
			
	// 		// Find and remove the entry that matches the decrease amount
	// 		for (const entry of existingHistory) {
	// 			if (!foundMatch && entry.quantity === decreaseAmount) {
	// 				// Found the matching purchase order - remove it (don't add to updatedHistory)
	// 				foundMatch = true;
	// 				continue;
	// 			}
	// 			// Keep all other entries
	// 			updatedHistory.push(entry);
	// 		}
			
	// 		// If no exact match found, try to handle partial decreases
	// 		if (!foundMatch) {
	// 			// Remove entries until we account for the decrease
	// 			let remainingDecrease = decreaseAmount;
	// 			const partialHistory: any[] = [];
				
	// 			for (const entry of existingHistory) {
	// 				if (remainingDecrease <= 0) {
	// 					partialHistory.push(entry);
	// 				} else if (entry.quantity <= remainingDecrease) {
	// 					remainingDecrease -= entry.quantity;
	// 					// Don't add (remove it)
	// 				} else {
	// 					// Partial adjustment
	// 					partialHistory.push({
	// 						...entry,
	// 						quantity: entry.quantity - remainingDecrease
	// 					});
	// 					remainingDecrease = 0;
	// 				}
	// 			}
	// 			// Update totalOrderQuantity for all remaining entries
	// 			const historyWithUpdatedTotal = partialHistory.map(entry => ({
	// 				...entry,
	// 				totalOrderQuantity: newIncoming
	// 			}));
	// 			updateData.$set = { incomingHistory: historyWithUpdatedTotal };
	// 		} else {
	// 			// Update totalOrderQuantity for all remaining entries
	// 			const historyWithUpdatedTotal = updatedHistory.map(entry => ({
	// 				...entry,
	// 				totalOrderQuantity: newIncoming
	// 			}));
	// 			// Set the new history array (with matched entry removed)
	// 			updateData.$set = { incomingHistory: historyWithUpdatedTotal };
	// 		}
	// 	} else {
	// 		// No change in incoming value
	// 		incomingLastChangedAt = existing?.incomingLastChangedAt || new Date();
	// 	}
		
	// 	updateData.incomingLastChangedAt = incomingLastChangedAt;
		
	// 	const updateOperation: any = { 
	// 		$set: {
	// 			shop: variant.shop,
	// 			inventoryItemId: variant.inventoryItemId,
	// 			variantId: variant.variantId,
	// 			productId: variant.productId,
	// 			incoming: newIncoming,
	// 			incomingLastChangedAt: incomingLastChangedAt
	// 		}
	// 	};
		
	// 	// Add $push operation if we have history to add (for increases)
	// 	if (updateData.$push) {
	// 		updateOperation.$push = updateData.$push;
	// 	}
		
	// 	// Add $set operation for history if we're replacing it (for decreases)
	// 	if (updateData.$set && updateData.$set.incomingHistory) {
	// 		// Sort by date ascending (oldest first) before saving
	// 		const sortedHistory = updateData.$set.incomingHistory.sort((a: any, b: any) => {
	// 			return new Date(a.date).getTime() - new Date(b.date).getTime();
	// 		});
	// 		updateOperation.$set.incomingHistory = sortedHistory;
	// 	}
		
	// 	bulkOps.push({
	// 		updateOne: {
	// 			filter: { shop: variant.shop, variantId: variant.variantId },
	// 			update: updateOperation,
	// 			upsert: true,
	// 		},
	// 	});
	// }
	
	// // Delete records where incoming became 0
	// if (variantsToDelete.length > 0) {
	// 	bulkOps.push({
	// 		deleteMany: {
	// 			filter: { 
	// 				shop: store, 
	// 				variantId: { $in: variantsToDelete } 
	// 			}
	// 		}
	// 	});
	// }
	
	// // Execute bulk operations only if there are any
	// if (bulkOps.length === 0) {
	// 	console.log(`[persistInventoryForProducts] No operations to perform (all incoming values are 0)`);
	// 	return;
	// }

	// try {
	// 	const result = await this.trackIncomingModel.bulkWrite(bulkOps, { ordered: false });
	// 	const deleteCount = variantsToDelete.length;
	// 	console.log(
	// 		`[persistInventoryForProducts] Successfully processed ${variantMap.size} variants. ` +
	// 		`Inserted: ${result.upsertedCount}, Modified: ${result.modifiedCount}, ` +
	// 		`Matched: ${result.matchedCount}, Deleted: ${deleteCount}`
	// 	);
	// } catch (error: any) {
	// 	console.error('[persistInventoryForProducts] Error during bulk write:', error);
	// 	throw new UnauthorizedException('Failed to persist variants');
	// }
	// }


	private async persistInventoryForProducts(products: any[], store: string): Promise<void> {
		console.log(`[persistInventoryForProducts] Persisting variants for ${products.length} products`);
	
		// --- STEP 1: Extract variants ---
		const { variantMap, variantIds } = this.extractVariants(products, store);
	
		if (variantMap.size === 0) {
			console.log(`[persistInventoryForProducts] No variants to persist`);
			return;
		}
	
		// --- STEP 2: Fetch existing records ---
		const existingMap = await this.fetchExistingVariantMap(variantIds, store);
	
		// --- STEP 3: Build bulk operations ---
		const { bulkOps, variantsToDelete } = this.buildBulkOperations(variantMap, existingMap, store);
	
		if (bulkOps.length === 0) {
			console.log(`[persistInventoryForProducts] No operations to perform (all incoming values are 0)`);
			return;
		}
	
		// --- STEP 4: Execute DB operations ---
		try {
			const result = await this.trackIncomingModel.bulkWrite(bulkOps, { ordered: false });
			console.log(
				`[persistInventoryForProducts] Successfully processed ${variantMap.size} variants. ` +
				`Inserted: ${result.upsertedCount}, Modified: ${result.modifiedCount}, ` +
				`Matched: ${result.matchedCount}, Deleted: ${variantsToDelete.length}`
			);
		} catch (error: any) {
			console.error('[persistInventoryForProducts] Error during bulk write:', error);
			throw new UnauthorizedException('Failed to persist variants');
		}
	}


	private extractVariants(products: any[], store: string) {
		const variantMap = new Map<number, any>();
		const variantIds: number[] = [];
	
		for (const product of products) {
			if (!product?.variants) continue;
	
			for (const variant of product.variants) {
				if (!variant?.id) continue;
	
				const variantId = Number(variant.id);
				const inventoryItemId = Number(variant.inventory_item_id);
				if (!inventoryItemId) continue;
	
				const productId = Number(variant.productId || product.id);
				if (!productId) continue;
	
				variantMap.set(variantId, {
					shop: store,
					productId,
					variantId,
					inventoryItemId,
					incoming: Number(variant.incoming || 0),
					committed: Number(variant.committed || 0)
				});
	
				variantIds.push(variantId);
			}
		}
	
		return { variantMap, variantIds };
	}

	private async fetchExistingVariantMap(variantIds: number[], store: string) {
		const existingRecords = await this.trackIncomingModel.find({
			shop: store,
			variantId: { $in: variantIds }
		}).lean();
	
		const map = new Map();
		for (const record of existingRecords) {
			map.set(record.variantId, record);
		}
		return map;
	}

	
	private buildBulkOperations(
		variantMap: Map<number, any>,
		existingMap: Map<number, any>,
		store: string
	) {
		const bulkOps: any[] = [];
		const variantsToDelete: number[] = [];
	
		for (const [variantId, variant] of variantMap.entries()) {
			const existing = existingMap.get(variantId);
			const oldIncoming = existing?.incoming || 0;
			const newIncoming = variant.incoming;
	
			// ----------- HANDLE DELETES -----------
			if (newIncoming <= 0) {
				if (existing) variantsToDelete.push(variantId);
				continue;
			}
	
			// ----------- HISTORY LOGIC -----------
			const updateOperation = this.buildUpdateOperation(
				variant,
				existing,
				oldIncoming,
				newIncoming
			);
	
			bulkOps.push({
				updateOne: {
					filter: { shop: store, variantId },
					update: updateOperation,
					upsert: true
				}
			});
		}
	
		// ----------- DELETE OLD VARIANTS -----------
		if (variantsToDelete.length > 0) {
			bulkOps.push({
				deleteMany: {
					filter: { shop: store, variantId: { $in: variantsToDelete } }
				}
			});
		}
	
		return { bulkOps, variantsToDelete };
	}
	
	
private buildUpdateOperation(variant, existing, oldIncoming, newIncoming) {
	const now = new Date();
	let historyUpdate: any = {};
	let incomingLastChangedAt: Date;

	// --- CASE 1: From 0 → positive (new PO)
	if (oldIncoming === 0 && newIncoming > 0) {
		incomingLastChangedAt = now;
		historyUpdate.$push = {
			incomingHistory: {
				date: now,
				quantity: newIncoming,
				totalOrderQuantity: newIncoming
			}
		};
	}

	// --- CASE 2: Increase (e.g. 5 → 8)
	else if (newIncoming > oldIncoming) {
		incomingLastChangedAt = now;
		historyUpdate.$push = {
			incomingHistory: {
				date: now,
				quantity: newIncoming - oldIncoming,
				totalOrderQuantity: newIncoming
			}
		};
	}

	// --- CASE 3: Decrease (partial receiving)
	else if (newIncoming < oldIncoming) {
		incomingLastChangedAt = now;
		historyUpdate.$set = {
			incomingHistory: this.recalculateDecreasedHistory(existing, oldIncoming, newIncoming)
		};
	}

	// --- CASE 4: No change in incoming value
	else {
		incomingLastChangedAt = existing?.incomingLastChangedAt || now;
	}

	// FINAL UPDATE OBJECT
	const updateOperation: any = {
		$set: {
			shop: variant.shop,
			inventoryItemId: variant.inventoryItemId,
			variantId: variant.variantId,
			productId: variant.productId,
			incoming: newIncoming,
			incomingLastChangedAt: incomingLastChangedAt
		}
	};

	// Add $push operation if we have history to add (for increases)
	if (historyUpdate.$push) {
		updateOperation.$push = historyUpdate.$push;
	}

	// Add $set operation for history if we're replacing it (for decreases)
	if (historyUpdate.$set && historyUpdate.$set.incomingHistory) {
		// Sort by date ascending (oldest first) before saving
		const sortedHistory = historyUpdate.$set.incomingHistory.sort((a: any, b: any) => {
			return new Date(a.date).getTime() - new Date(b.date).getTime();
		});
		updateOperation.$set.incomingHistory = sortedHistory;
	}

	return updateOperation;
}
	

	private recalculateDecreasedHistory(existing, oldIncoming, newIncoming) {
		const decreaseAmount = oldIncoming - newIncoming;
		const history = [...(existing?.incomingHistory || [])]
			.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
	
		let remaining = decreaseAmount;
		const result: any[] = [];
	
		for (const entry of history) {
			if (remaining <= 0) {
				result.push(entry);
				continue;
			}
	
			if (entry.quantity <= remaining) {
				remaining -= entry.quantity;
				continue; // drop this entry
			}
	
			// partial reduce
			result.push({
				...entry,
				quantity: entry.quantity - remaining
			});
			remaining = 0;
		}
	
		// Update totalOrderQuantity for newIncoming
		return result.map(entry => ({
			...entry,
			totalOrderQuantity: newIncoming
		}));
	}
	


	async getIncoming( store: string, variantId: string ): Promise<any> {

		console.log( `[getIncoming] Getting incoming for variant ${variantId} for store ${store}` );
		const shop = await this.getShop(store);
		if ( !shop) {
			throw new UnauthorizedException('Shop not found. Please complete OAuth flow first.');
		}

		const variant = await this.trackIncomingModel.findOne({ variantId: Number(variantId), shop: store });
		console.log( `[getIncoming] Incoming for variant ${variantId} for store ${store}:`, variant );
		return variant;
	}
}