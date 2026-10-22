import type { CartItem, SaleSummary } from "./types";

interface SaleChargeControls {
  vatRate?: number;
  serviceChargeEnabled?: boolean;
  serviceChargeRate?: number;
}

export function calculateSale(items: CartItem[], controls: SaleChargeControls = {}): SaleSummary {
  const subtotal = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const discount = items.reduce((sum, item) => sum + item.discount * item.quantity, 0);
  const taxableBase = Math.max(subtotal - discount, 0);
  const serviceChargeRate = controls.serviceChargeRate ?? 0.05;
  const serviceCharge = controls.serviceChargeEnabled === false ? 0 : Math.round(taxableBase * serviceChargeRate);
  const vat = items.reduce((sum, item) => {
    const lineBase = Math.max((item.product.price - item.discount) * item.quantity, 0);
    return sum + Math.round(lineBase * (controls.vatRate ?? item.product.taxRate));
  }, 0);

  return {
    subtotal,
    discount,
    serviceCharge,
    vat,
    total: taxableBase + serviceCharge + vat
  };
}

export function applyManagerApproval(action: string, amount: number) {
  const sensitive = ["refund", "void", "stock-adjustment", "register-close"];
  return sensitive.includes(action) || amount >= 50000;
}

/** Clearance on a product, if it is running (same rules as the server and the tablet app). */
export function activeClearance(product: CartItem["product"], now = new Date()) {
  const price = product.clearancePrice;
  const remaining = Number(product.clearanceRemaining ?? 0);
  if (price === null || price === undefined || remaining <= 0 || price < 0 || price >= product.price) return null;
  if (product.clearanceEndsAt) {
    const [year, month, day] = product.clearanceEndsAt.split("-").map(Number);
    if (now.getTime() > new Date(year, month - 1, day, 23, 59, 59, 999).getTime()) return null;
  }
  const discount = product.price - price;
  return { price, remaining, discount, percent: Math.round((discount / product.price) * 100), endsAt: product.clearanceEndsAt ?? null };
}

/** Splits cart items into the lines actually sold: clearance units first at the clearance price, then the rest. */
export function expandCart(items: CartItem[], now = new Date()): CartItem[] {
  const lines: CartItem[] = [];
  for (const item of items) {
    const clearance = activeClearance(item.product, now);
    const units = clearance ? Math.min(item.quantity, clearance.remaining) : 0;
    if (units > 0) lines.push({ product: item.product, quantity: units, discount: clearance!.discount, note: item.note, clearance: true });
    if (item.quantity - units > 0) lines.push({ ...item, quantity: item.quantity - units, clearance: undefined });
  }
  return lines;
}

/** Discount given by hand (price changes), i.e. everything except clearance prices. */
export function manualDiscount(items: CartItem[]) {
  return expandCart(items)
    .filter((line) => !line.clearance)
    .reduce((sum, line) => sum + line.discount * line.quantity, 0);
}
