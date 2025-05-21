export interface FormData {
    description: string;
    isVisible: boolean;
    name: string;
    price: number;
    type: string;
    components?: Array<{
        sku: string;
        name: string;
        quantity: number;
    }>;
}

export interface TableItem {
    id: number;
    name: string;
    sku: string;
    price: number;
    stock: number;
}

export interface ListItem extends FormData {
    id: number;
}

export interface StringKeyValue {
    [key: string]: string;
}
