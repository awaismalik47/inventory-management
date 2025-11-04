export interface ProductQueryModel {
    store?: string;
    limit?: string;
}


export interface IProductModel {
    id         : number;
    title      : string;
    sku        : string;
    productType: string;
    status     : string;
    variants   : IVariantModel[];
    options    : IOptionModel[];
    imageUrl   : string;
}


export interface IVariantModel {
    id                    : number;
    productId             : number;
    imageSrc              : string;
    title                 : string;
    price                 : string;
    sku                   : string;
    inventoryQuantity     : number;
    oldInventoryQuantity  : number;
    inventory_item_id?    : number;
    inventory_location_id?: number | null;
    available?            : number;
    incoming?             : number;
    on_hand?              : number;
    committed?            :  number;
}

export interface IOptionModel {
    id       : number;
    productId: number;
    name     : string;
    values   : string[];
}