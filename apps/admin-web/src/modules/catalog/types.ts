export type ProductCategory = string;

export interface Product {
  id: string;
  branchId: string;
  name: string;
  sku: string;
  barcode: string;
  category: ProductCategory;
  price: number;
  cost: number;
  taxRate: number;
  image: string;
  stock: number;
  reorderPoint: number;
  station: "Kitchen" | "Bar" | "Counter";
  modifiers: string[];
}
