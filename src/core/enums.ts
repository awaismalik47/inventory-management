export enum UrgencyLevelEnum {
	Low      = 'low',
	Medium   = 'medium',
	High     = 'high',
	Critical = 'critical',
}


export enum WebhookTopicEnum {
	OrdersCreate         = 'orders/create',
	ProductsUpdate       = 'products/update',
	ProductsDelete       = 'products/delete',
	ProductsCreate       = 'products/create',
	AppUninstalled       = 'app/uninstalled',
	InventoryItemsUpdate = 'inventory_items/update',
	InventoryItemsCreate = 'inventory_items/create',
	InventoryItemsDelete = 'inventory_items/delete'
}
