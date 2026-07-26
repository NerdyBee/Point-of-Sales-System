import type { Product } from "../catalog/types";

export interface CartItem {
  product: Product;
  quantity: number;
  note?: string;
  discount: number;
}

export interface PaymentMethod {
  id: string;
  label: string;
  amount: number;
}

export interface SaleSummary {
  subtotal: number;
  discount: number;
  serviceCharge: number;
  vat: number;
  total: number;
}

export type SaleSyncState =
  | { status: "idle" }
  | { status: "loading"; message: string }
  | { status: "success"; message: string; saleId: string }
  | { status: "error"; message: string };
