import type { Product, TenantSettings } from "../data/readModel";

/**
 * Mirrors previewSaleTotal in server/api/src/modules/sales/sales.service.ts.
 * The server re-prices every replayed sale and rejects it if payments do not equal
 * its total, so this must stay identical (rounding included).
 */

export interface CartLine {
  product: Product;
  quantity: number;
  /** Per-unit discount. */
  discount: number;
  note?: string;
}

export interface SaleSummary {
  lines: { productId: string; name: string; quantity: number; unitPrice: number; subtotal: number; discount: number; vat: number; total: number }[];
  subtotal: number;
  discount: number;
  serviceCharge: number;
  vat: number;
  total: number;
}

export function calculateSale(lines: CartLine[], settings: Pick<TenantSettings, "defaultTaxRate" | "serviceChargeEnabled" | "serviceChargeRate">): SaleSummary {
  const serviceChargeEnabled = settings.serviceChargeEnabled ?? true;
  const serviceChargeRate = settings.serviceChargeRate ?? 0.05;
  const vatRate = settings.defaultTaxRate;

  const priced = lines.map((line) => {
    const subtotal = line.product.price * line.quantity;
    const discount = line.discount * line.quantity;
    const taxableBase = Math.max(subtotal - discount, 0);
    const vat = Math.round(taxableBase * (vatRate ?? line.product.taxRate));
    return {
      productId: line.product.id,
      name: line.product.name,
      quantity: line.quantity,
      unitPrice: line.product.price,
      subtotal,
      discount,
      vat,
      total: taxableBase + vat
    };
  });

  const subtotal = priced.reduce((sum, line) => sum + line.subtotal, 0);
  const discount = priced.reduce((sum, line) => sum + line.discount, 0);
  const serviceCharge = serviceChargeEnabled ? Math.round(Math.max(subtotal - discount, 0) * serviceChargeRate) : 0;
  const vat = priced.reduce((sum, line) => sum + line.vat, 0);
  const total = priced.reduce((sum, line) => sum + line.total, 0) + serviceCharge;

  return { lines: priced, subtotal, discount, serviceCharge, vat, total };
}

const locales: Record<string, string> = { NGN: "en-NG", USD: "en-US", GHS: "en-GH", KES: "en-KE", ZAR: "en-ZA" };
const symbols: Record<string, string> = { NGN: "₦", USD: "$", GHS: "GH₵", KES: "KSh", ZAR: "R" };

export function formatMoney(amount: number, currency = "NGN") {
  try {
    return new Intl.NumberFormat(locales[currency] ?? "en-NG", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    const grouped = Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${symbols[currency] ?? ""}${grouped}`;
  }
}
