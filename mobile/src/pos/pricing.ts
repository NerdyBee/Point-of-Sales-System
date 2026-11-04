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
  /** Units sold at an owner-set clearance price (see clearance.ts expandCart). */
  clearance?: boolean;
}

export interface SaleSummary {
  lines: { productId: string; name: string; quantity: number; unitPrice: number; subtotal: number; discount: number; vat: number; total: number; clearance?: boolean }[];
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
      total: taxableBase + vat,
      ...(line.clearance ? { clearance: true } : {})
    };
  });

  const subtotal = priced.reduce((sum, line) => sum + line.subtotal, 0);
  const discount = priced.reduce((sum, line) => sum + line.discount, 0);
  const serviceCharge = serviceChargeEnabled ? Math.round(Math.max(subtotal - discount, 0) * serviceChargeRate) : 0;
  const vat = priced.reduce((sum, line) => sum + line.vat, 0);
  const total = priced.reduce((sum, line) => sum + line.total, 0) + serviceCharge;

  return { lines: priced, subtotal, discount, serviceCharge, vat, total };
}

const symbols: Record<string, string> = { NGN: "₦", USD: "$", GHS: "GH₵", KES: "KSh", ZAR: "R", GBP: "£", EUR: "€", CAD: "$", AUD: "$", INR: "₹", JPY: "¥" };

/**
 * Amounts are stored as whole numbers of the business's smallest unit: with 2 decimal places,
 * 499 means 4.99. The decimal places are the business's `moneyDecimals` setting, applied by
 * AppContext when the business loads (missing = 0, whole units, as before).
 */
let activeDecimals = 0;

export function setMoneyDecimals(decimals: number | undefined) {
  activeDecimals = Number.isInteger(decimals) && decimals! > 0 ? Math.min(decimals!, 3) : 0;
}

export function moneyDecimals() {
  return activeDecimals;
}

/** Stored amount → the number a person reads and types (499 → 4.99). */
export function toMajorUnits(amount: number, decimals = activeDecimals) {
  return amount / 10 ** decimals;
}

/** Number a person typed → stored amount (4.99 → 499). */
export function fromMajorUnits(value: number, decimals = activeDecimals) {
  return Math.round(value * 10 ** decimals);
}

/** 1234.5 → "1,234.50" with the given decimal places; no locale data needed. */
export function groupAmount(major: number, decimals = activeDecimals) {
  const [whole, fraction] = Math.abs(major).toFixed(decimals).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${major < 0 ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}

export function formatMoney(amount: number, currency = "NGN", decimals = activeDecimals) {
  const major = toMajorUnits(amount, decimals);
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "narrowSymbol", minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(major);
  } catch {
    // Older Android Intl data: build it by hand.
    const symbol = symbols[currency] ?? `${currency} `;
    return major < 0 ? `-${symbol}${groupAmount(-major, decimals)}` : `${symbol}${groupAmount(major, decimals)}`;
  }
}
