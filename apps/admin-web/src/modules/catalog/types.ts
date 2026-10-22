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
  /** Clearance (near expiry): units still to sell at clearancePrice until clearanceEndsAt (YYYY-MM-DD). */
  clearancePrice?: number | null;
  clearancePercent?: number | null;
  clearanceRemaining?: number;
  clearanceEndsAt?: string | null;
  clearanceExpiry?: string | null;
}
